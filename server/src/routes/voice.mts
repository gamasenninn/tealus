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
import { fireWebhooks } from '../services/webhook.mts';
import { fetchReplyMessage } from '../socket/handlers/message.mts';

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

    io.to(roomId).emit('message:new', fullMessage);

    // Webhook notification
    fireWebhooks('message.created', roomId, {
      room: { id: roomId },
      message: { id: message.id, type: 'voice', content: null, reply_to: replyTo || null, reply_to_message: fullMessage.reply_to_message || null, sender: { id: req.user!.id, display_name: req.user!.display_name } },
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
