const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/push/subscribe
 * Register or update a push subscription
 */
router.post('/subscribe', async (req, res) => {
  const userId = req.user.id;
  const { endpoint, p256dh_key, auth_key, device_name } = req.body;

  if (!endpoint || !p256dh_key || !auth_key) {
    return res.status(400).json({ error: 'endpoint, p256dh_key, auth_keyは必須です' });
  }

  try {
    const result = await pool.query(
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

    const isNew = result.rows[0].created_at.getTime() === result.rows[0].updated_at.getTime();
    res.status(isNew ? 201 : 200).json({ subscription: result.rows[0] });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * DELETE /api/push/subscribe
 * Remove a push subscription
 */
router.delete('/subscribe', async (req, res) => {
  const userId = req.user.id;
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
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;
