import { logger } from '../../utils/logger.mts';
import * as E from '../../constants/errors.mts';
import express from 'express';
import { pool } from '../../db/pool.mts';

/**
 * 管理画面「AIの班」(2026-11-20 利用者判断、docs/12 §7)。
 *
 * ★ 配達役 (courier/) が 1 分ごとに送る鼓動 (heartbeats の name = 'courier') をそのまま返す。
 *   中身は班ごとの状態・新着の数・その状態になった時刻と problem だけ (配達役が本文や画面を載せない作り)
 * ★ 配達役が複数の機械にいれば、送った人ごとに 1 行
 */
export const router = express.Router();

/** GET /api/admin/courier */
router.get('/courier', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.user_id, u.display_name, h.last_seen, h.info
         FROM heartbeats h
         JOIN users u ON u.id = h.user_id
        WHERE h.name = 'courier'
        ORDER BY h.last_seen DESC`
    );
    res.json({ couriers: result.rows });
  } catch (err) {
    logger.error('Admin courier status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
