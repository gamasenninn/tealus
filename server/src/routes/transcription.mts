import { getIo } from '../io-registry.mts';
import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { learnFromEdit } from '../services/dictionaryLearner.mts';
import { transcribeVoiceMessage } from '../services/transcription.mts';

export const router = express.Router({ mergeParams: true });

/** messages + rooms JOIN で編集権限判定に使う行 */
interface VoiceMessageRow {
  sender_id: string;
  room_id: string;
  allow_member_transcription_edit: boolean;
}

/**
 * PUT /api/messages/:id/transcription
 * Edit transcription text (sender only)
 */
router.put('/', authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user!.id;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'テキストは必須です' });
  }

  try {
    // Check message exists
    const msgResult = await pool.query<VoiceMessageRow>(
      'SELECT m.sender_id, m.room_id, r.allow_member_transcription_edit FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = $1 AND m.type = $2',
      [messageId, 'voice']
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const { sender_id, room_id, allow_member_transcription_edit } = msgResult.rows[0];

    if (sender_id !== userId) {
      if (!allow_member_transcription_edit) {
        return res.status(403).json({ error: '送信者のみ編集できます' });
      }
      // ルーム設定でメンバー編集が許可されている場合、メンバーかチェック
      const memberCheck = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room_id, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'ルームメンバーのみ編集できます' });
      }
    }

    // Get current max version
    const versionResult = await pool.query<{ max_version: number | null }>(
      'SELECT MAX(version) as max_version FROM voice_transcriptions WHERE message_id = $1',
      [messageId]
    );
    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Get raw_text + prior formatted_text from latest version
    const latestResult = await pool.query<{ raw_text: string | null; formatted_text: string | null }>(
      'SELECT raw_text, formatted_text FROM voice_transcriptions WHERE message_id = $1 ORDER BY version DESC LIMIT 1',
      [messageId]
    );
    const rawText = latestResult.rows[0]?.raw_text || '';
    const priorFormatted = latestResult.rows[0]?.formatted_text || '';

    // Insert new version
    const result = await pool.query<{ message_id: string; version: number; raw_text: string | null; formatted_text: string; status: string }>(
      `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status, edited_by)
       VALUES ($1, $2, $3, $4, 'done', $5)
       RETURNING message_id, version, raw_text, formatted_text, status`,
      [messageId, newVersion, rawText, text.trim(), userId]
    );

    const transcription = result.rows[0];

    // #327 自己成長: 人間編集(AI版→人間版)から garble→term を学習し辞書テーブルを育てる。
    // fire-and-forget（応答をブロックしない・失敗は編集を妨げない）。
    learnFromEdit({ priorFormatted, newFormatted: text.trim() })
      // 発火を常に記録 (learned=0 でも「届いた+ゲート棄却」と「不発」を log で区別する)
      // ★ #371 棄却は理由別に出す。1 つのカウンタでは「何を直せば拾えるか」が読めない
      //   (実測: 抽出 146 のうち 118 = 80.8% が gate-rejected だが内訳が不明だった)
      .then((r) => {
        const by = r.gateRejectedBy;
        const detail = r.gateRejected
          ? ` (モーラ数 ${by.moras} / 音韻 ${by.phonetic} / term不在 ${by.noTerm})`
          : '';
        logger.info(`[dictionary] edit ${messageId}: extracted ${r.extracted} → +${r.promoted} active / +${r.pending} pending / ${r.gateRejected} gate-rejected${detail}`);
        // ★ 件数だけでは「読み誤りで落ちたか、本当に音が遠いか」が区別できない (#371)。
        //   実例: 終礼 を pykakasi が「おわりれい」と訓読みし、修繕(しゅうぜん) との距離が
        //   1.00 になって棄却。正しい「しゅうれい」なら 0.50 = ちょうど通過だった。
        for (const x of r.gateRejections) {
          const metric = x.reason === 'moras' ? `${x.moras} モーラ` : `距離 ${x.distance.toFixed(2)}`;
          logger.info(`[dictionary] gate-reject ${x.reason}: 「${x.garble}」(${x.garbleReading}) → 「${x.term}」(${x.termReading}) ${metric}`);
        }
      })
      .catch((err: unknown) => logger.warn(`[dictionary] learnFromEdit failed for ${messageId}: ${err instanceof Error ? err.message : String(err)}`));

    // Broadcast update
    const io = getIo();
    const roomId = msgResult.rows[0].room_id;
    io.to(roomId).emit('voice:transcription', {
      message_id: messageId,
      status: 'done',
      raw_text: rawText,
      formatted_text: text.trim(),
      version: newVersion,
    });

    res.json({ transcription });
  } catch (err) {
    logger.error('Transcription edit error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/** 編集履歴 1 行 (users JOIN で編集者名付き) */
interface TranscriptionHistoryRow {
  message_id: string;
  version: number;
  raw_text: string | null;
  formatted_text: string | null;
  status: string;
  edited_by: string | null;
  created_at: Date;
  edited_by_name: string | null;
}

/**
 * GET /api/messages/:id/transcription/history
 * Get transcription edit history (room members only)
 */
router.get('/history', authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user!.id;

  try {
    // Check message exists and user is room member
    const msgResult = await pool.query<{ room_id: string }>(
      'SELECT room_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [msgResult.rows[0].room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームにアクセスする権限がありません' });
    }

    const result = await pool.query<TranscriptionHistoryRow>(
      `SELECT vt.message_id, vt.version, vt.raw_text, vt.formatted_text, vt.status, vt.edited_by, vt.created_at,
              u.display_name AS edited_by_name
       FROM voice_transcriptions vt
       LEFT JOIN users u ON u.id = vt.edited_by
       WHERE vt.message_id = $1
       ORDER BY vt.version DESC`,
      [messageId]
    );

    res.json({ history: result.rows });
  } catch (err) {
    logger.error('Transcription history error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/messages/:id/transcription/retranscribe
 * Retry transcription (creates new version with status='pending')
 * #216: Whisper 失敗時の再実行機能
 */
router.post('/retranscribe', authenticate, async (req: Request, res: Response) => {
  // 親ルーターの :id (mergeParams)。express 5 の型は string | string[] だが単一パラメータなので常に string
  const messageId = req.params.id as string;
  const userId = req.user!.id;

  try {
    // Check message exists + permission (same logic as PUT)
    const msgResult = await pool.query<VoiceMessageRow>(
      'SELECT m.sender_id, m.room_id, r.allow_member_transcription_edit FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = $1 AND m.type = $2',
      [messageId, 'voice']
    );
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'メッセージが見つかりません' });
    }

    const { sender_id, room_id, allow_member_transcription_edit } = msgResult.rows[0];

    if (sender_id !== userId) {
      if (!allow_member_transcription_edit) {
        return res.status(403).json({ error: '送信者のみ再文字起こしできます' });
      }
      const memberCheck = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room_id, userId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ error: 'ルームメンバーのみ再文字起こしできます' });
      }
    }

    // Get audio file path from message_media
    const mediaResult = await pool.query<{ file_path: string }>(
      'SELECT file_path FROM message_media WHERE message_id = $1 LIMIT 1',
      [messageId]
    );
    if (mediaResult.rows.length === 0) {
      return res.status(404).json({ error: '音声ファイルが見つかりません' });
    }
    const filePath = mediaResult.rows[0].file_path;

    // Compute new version
    const versionResult = await pool.query<{ max_version: number | null }>(
      'SELECT MAX(version) as max_version FROM voice_transcriptions WHERE message_id = $1',
      [messageId]
    );
    const newVersion = (versionResult.rows[0].max_version || 0) + 1;

    // Insert new version row with status='pending', edited_by=requestUser
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, version, status, edited_by)
       VALUES ($1, $2, 'pending', $3)`,
      [messageId, newVersion, userId]
    );

    // Respond immediately (async transcription kicks off)
    res.status(202).json({
      message_id: messageId,
      version: newVersion,
      status: 'pending',
    });

    // Async transcription on the new version
    const io = getIo();
    transcribeVoiceMessage(messageId, filePath, io, room_id, newVersion).catch(err => {
      logger.error('Retranscribe error:', err);
    });
  } catch (err) {
    logger.error('Retranscribe error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
