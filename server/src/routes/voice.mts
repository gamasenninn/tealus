import { getIo } from '../io-registry.mts';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import crypto from 'node:crypto';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';
import { transcribeVoiceMessage } from '../services/transcription.mts';
import { decodeFileName } from '../middleware/upload.mts';
import { fetchReplyMessage } from '../socket/handlers/message.mts';
import { announcePost } from '../services/postEffects.mts';
import { checkMessageRefs } from '../services/messageRefs.mts';
import fs from 'node:fs';

export const router = express.Router({ mergeParams: true });

const VOICE_DIR = path.join(process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../../media'), 'voices');

const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VOICE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

/** messages INSERT RETURNING * のうちハンドラが参照する列 */
interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  type: string;
  content: string | null;
  reply_to: string | null;
  created_at: Date;
}

/** message_media INSERT RETURNING * のうちハンドラが参照する列 */
interface MediaRow {
  id: string;
  message_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
}

/**
 * POST /api/rooms/:id/voice
 * Upload a voice message
 */
router.post('/', authenticate, requireMember, (req, res, next) => {
  voiceUpload.single('voice')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'ファイルサイズが上限を超えています' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  // 親ルーターの :id (mergeParams)。express 5 の型は string | string[] だが単一パラメータなので常に string
  const roomId = req.params.id as string;
  const userId = req.user!.id;

  if (!req.file) {
    return res.status(400).json({ error: '音声ファイルが添付されていません' });
  }

  // ★ #482 返信先は同じ部屋の投稿だけ。断るときは受け取ったファイルを消す (メッセージに紐づかないまま残さない)
  const refs = await checkMessageRefs({ roomId, userId, replyTo: req.body.reply_to });
  if (!refs.ok) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(refs.status).json({ error: refs.error });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create voice message
    const replyTo = req.body.reply_to || null;
    const msgResult = await client.query<MessageRow>(
      `INSERT INTO messages (room_id, sender_id, type, reply_to)
       VALUES ($1, $2, 'voice', $3)
       RETURNING *`,
      [roomId, userId, replyTo]
    );
    const message = msgResult.rows[0];

    const relativePath = `voices/${req.file.filename}`;

    // Create media record
    const mediaResult = await client.query<MediaRow>(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [message.id, relativePath, decodeFileName(req.file.originalname), req.file.mimetype, req.file.size]
    );

    // Create pending transcription record (for Step B)
    await client.query(
      `INSERT INTO voice_transcriptions (message_id, status)
       VALUES ($1, 'pending')`,
      [message.id]
    );

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const io = getIo();
    const fullMessage: Record<string, unknown> = {
      ...message,
      sender_display_name: req.user!.display_name,
      sender_avatar_url: req.user!.avatar_url,
      media: [mediaResult.rows[0]],
      reply_to_message: null,
    };

    // Attach reply_to message info
    if (replyTo) {
      fullMessage.reply_to_message = await fetchReplyMessage(replyTo);
    }

    // ★ 付随処理は announcePost から (docs/07 §5.1、#8)
    // ★★ 移したことで順番だけ変わった: 以前は「AI 通知 → 通知」、今は入口の順の「通知 → AI 通知」(2026-10-01 利用者判断)。
    //   人は通知を待たないので差は無い。機械は通知 (部屋の設定を DB に聞く) を待ってから AI 通知を投げる分、数 ms 遅れる
    await announcePost({
      roomId,
      emit: fullMessage,
      // ★ 2026-09-27 (#383): 人が送った音声にも通知を鳴らす。
      // ★ 2026-09-28 (#463): 機械 (is_bot) の分は、ルームの管理者が「機械の投稿も鳴らす」を選んだルームだけ鳴らす
      //   —— トランシーバーは 1 日 57 件・12 人。既定で鳴らすと、止めたい人が各自でオフにするまで鳴り続ける
      push: req.user!.is_bot
        ? { kind: 'machine', post: { roomId, senderId: userId, senderName: req.user!.display_name, messageId: message.id, body: '🎤 音声メッセージ' } }
        : { kind: 'human', senderId: userId, payload: { title: req.user!.display_name, body: '🎤 音声メッセージ', data: { roomId, messageId: message.id } } },
      webhook: { kind: 'on', payload: {
        room: { id: roomId },
        message: { id: message.id, type: 'voice', content: null, reply_to: replyTo || null, reply_to_message: fullMessage.reply_to_message || null, sender: { id: req.user!.id, display_name: req.user!.display_name } },
      } },
      preview: { kind: 'off', reason: '不明 (docs/07 §3.2)。音声は本文を持たない (文字起こしは後から入る)' },
    });

    res.status(201).json({
      message,
      media: mediaResult.rows[0],
    });

    // Async transcription (don't await — run in background)
    transcribeVoiceMessage(message.id, `voices/${req.file.filename}`, io, roomId).catch(err => {
      logger.error('Background transcription error:', err);
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Voice upload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});
