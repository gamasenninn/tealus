import { logger } from '../utils/logger.mts';
import * as E from '../constants/errors.mts';
import express from 'express';
import { pool } from '../db/pool.mts';
import { authenticate } from '../middleware/auth.mts';

export const router = express.Router();

router.use(authenticate);

/** push_subscriptions INSERT ... RETURNING * のうちハンドラが参照する列 */
interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  device_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * POST /api/push/subscribe
 * Register or update a push subscription
 */
router.post('/subscribe', async (req, res) => {
  const userId = req.user!.id;
  const { endpoint, p256dh_key, auth_key, device_name } = req.body;

  if (!endpoint || !p256dh_key || !auth_key) {
    return res.status(400).json({ error: 'endpoint, p256dh_key, auth_keyは必須です' });
  }

  try {
    // 同じ endpoint の他ユーザーの古い購読を削除（1ブラウザ = 1ユーザー）
    await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id != $2',
      [endpoint, userId]
    );

    const result = await pool.query<PushSubscriptionRow>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, device_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET
         p256dh_key = EXCLUDED.p256dh_key,
         auth_key = EXCLUDED.auth_key,
         device_name = EXCLUDED.device_name,
         is_active = true,
         updated_at = now()
       RETURNING *`,
      [userId, endpoint, p256dh_key, auth_key, device_name || null]
    );
    logger.debug(`push: subscribe user=${userId} endpoint=${endpoint.slice(-20)}`);

    const isNew = result.rows[0].created_at.getTime() === result.rows[0].updated_at.getTime();
    res.status(isNew ? 201 : 200).json({ subscription: result.rows[0] });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/push/subscribe
 * Remove a push subscription
 */
router.delete('/subscribe', async (req, res) => {
  const userId = req.user!.id;
  const { endpoint } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: 'endpointは必須です' });
  }

  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [userId, endpoint]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});
