import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';
import { requireMember } from '../middleware/roomAccess.mts';
import { rankAddresses } from '../services/voiceAddress.mts';

/**
 * GET /api/rooms/:id/voice-address-candidates — 音声の編集画面に並べる「宛名の候補」(読み取り専用)
 *
 * その部屋で**人が直した**文字起こしの冒頭の呼びかけを多い順に返す。規則は services/voiceAddress.mts。
 * ★ 機械の版 (edited_by が無い) は数えない —— 崩れた宛名が候補に並ぶと、直すための道具が誤りを勧める。
 * ★ 1 つの音声を何度直しても、数えるのはその音声の最後の人の版 1 つ。
 */
export const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(requireMember);

/** 数える範囲。古い呼び名 (異動した人など) がいつまでも上に残らないように */
const WINDOW_DAYS = 90;

router.get('/', async (req, res) => {
  try {
    const result = await pool.query<{ formatted_text: string | null }>(
      `SELECT DISTINCT ON (vt.message_id) vt.formatted_text
         FROM voice_transcriptions vt
         JOIN messages m ON m.id = vt.message_id
        WHERE m.room_id = $1
          AND NOT m.is_deleted
          AND vt.edited_by IS NOT NULL
          AND vt.created_at > now() - make_interval(days => $2)
        ORDER BY vt.message_id, vt.version DESC`,
      [(req.params as { id: string }).id, WINDOW_DAYS]
    );
    const texts = result.rows.map((r) => r.formatted_text ?? '');
    res.json({ candidates: rankAddresses(texts) });
  } catch (err) {
    logger.error('voice-address-candidates error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
