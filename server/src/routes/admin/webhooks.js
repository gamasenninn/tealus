const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const pool = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/admin/webhooks
 * Webhook一覧取得
 */
router.get('/webhooks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.room_id, r.name as room_name, r.type as room_type, w.url, w.events, w.is_active, w.created_at,
              (SELECT string_agg(u.display_name, ' ↔ ')
               FROM room_members rm JOIN users u ON u.id = rm.user_id
               WHERE rm.room_id = r.id) AS dm_member_names
       FROM webhooks w
       LEFT JOIN rooms r ON r.id = w.room_id
       ORDER BY w.created_at DESC`
    );
    // DM ルームの場合、room_name をメンバー名で補完
    const webhooks = result.rows.map(w => ({
      ...w,
      room_name: w.room_name || (w.room_type === 'direct' ? w.dm_member_names : null),
      dm_member_names: undefined,
      room_type: undefined,
    }));
    res.json({ webhooks });
  } catch (err) {
    logger.error('Admin list webhooks error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/webhooks
 * Webhook登録
 */
router.post('/webhooks', async (req, res) => {
  const { url, room_id, secret, events = ['message.created'] } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URLは必須です' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO webhooks (url, room_id, secret, events, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, room_id, url, events, is_active, created_at`,
      [url, room_id || null, secret || null, events, req.user.id]
    );

    res.status(201).json({ webhook: result.rows[0] });
  } catch (err) {
    logger.error('Admin create webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/webhooks/:id
 * Webhook更新
 */
router.put('/webhooks/:id', async (req, res) => {
  const { id } = req.params;
  const { url, room_id, secret, events, is_active } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (url !== undefined) { updates.push(`url = $${paramIndex++}`); values.push(url); }
    if (room_id !== undefined) { updates.push(`room_id = $${paramIndex++}`); values.push(room_id || null); }
    if (secret !== undefined) { updates.push(`secret = $${paramIndex++}`); values.push(secret); }
    if (events !== undefined) { updates.push(`events = $${paramIndex++}`); values.push(events); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE webhooks SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, room_id, url, events, is_active, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }

    res.json({ webhook: result.rows[0] });
  } catch (err) {
    logger.error('Admin update webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/admin/webhooks/:id
 * Webhook削除
 */
router.delete('/webhooks/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin delete webhook error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/webhooks/:id/test
 * テスト送信
 */
router.post('/webhooks/:id/test', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM webhooks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhookが見つかりません' });
    }

    const webhook = result.rows[0];
    const payload = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      message: { content: 'Tealus Webhook テスト送信' },
    });

    const { dispatchWebhook } = require('../../services/webhook');
    const testResult = await dispatchWebhook(webhook, payload);

    res.json({ success: testResult.ok, status: testResult.status });
  } catch (err) {
    logger.error('Admin test webhook error:', err);
    res.status(502).json({ error: 'テスト送信に失敗しました', details: err.message });
  }
});

module.exports = router;
