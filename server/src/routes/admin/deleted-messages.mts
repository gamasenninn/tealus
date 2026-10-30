import { logger } from '../../utils/logger.mts';
import * as E from '../../constants/errors.mts';
import express from 'express';
import { pool } from '../../db/pool.mts';
import { isUuid, badIdMessage } from '../../utils/uuid.mts';

/**
 * 削除した投稿の本文を、全体の管理者だけが見て・戻す (2026-10-30 利用者判断 3、docs/02 deleted_message_contents)。
 *
 * ★ 削除で messages.content を null にするのは変えない (検索・AI・配信の口は今までどおり)。本文はここにだけある。
 * ★ 戻すと本文を書き戻して削除の印を外す。部屋を開いている人の画面には、開き直したときに出る
 */
export const router = express.Router();

/** GET /api/admin/deleted-messages — 新しい順に 100 件 */
router.get('/deleted-messages', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.message_id, d.content, d.deleted_at, m.type, m.room_id, m.created_at,
              r.name AS room_name, s.display_name AS sender_display_name, b.display_name AS deleted_by_display_name
         FROM deleted_message_contents d
         JOIN messages m ON m.id = d.message_id
         JOIN rooms r ON r.id = m.room_id
         JOIN users s ON s.id = m.sender_id
         LEFT JOIN users b ON b.id = d.deleted_by
        ORDER BY d.deleted_at DESC
        LIMIT 100`
    );
    res.json({ messages: result.rows });
  } catch (err) {
    logger.error('Admin list deleted messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/** POST /api/admin/deleted-messages/:id/restore — 本文を書き戻して削除の印を外す */
router.post('/deleted-messages/:id/restore', async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: badIdMessage(String(id)) });
  try {
    // ★ 1 つの文で行う (書き戻しと退避の行の削除を揃える)
    const result = await pool.query(
      `WITH gone AS (
         DELETE FROM deleted_message_contents WHERE message_id = $1 RETURNING message_id, content
       )
       UPDATE messages m SET is_deleted = false, content = gone.content, updated_at = now()
         FROM gone WHERE m.id = gone.message_id
       RETURNING m.id, m.room_id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '戻せる本文がありません (退避より前に消した投稿は戻せません)' });
    logger.info(`[deleted-messages] 管理者 ${req.user!.login_id} が投稿 ${id} を戻した (部屋 ${result.rows[0].room_id})`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin restore deleted message error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
