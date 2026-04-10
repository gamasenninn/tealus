const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const { SALT_ROUNDS } = require('../constants/config');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, employee_id, display_name, avatar_url, status_message, role, is_active, last_seen_at, created_at, updated_at FROM users ORDER BY created_at'
    );
    res.json({ users: result.rows });
  } catch (err) {
    logger.error('Admin list users error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/users
 * Create a new user
 */
router.post('/users', async (req, res) => {
  const { employee_id, display_name, password, role = 'user' } = req.body;

  if (!employee_id || !display_name || !password) {
    return res.status(400).json({ error: '社員番号、表示名、パスワードは必須です' });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE employee_id = $1',
      [employee_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'この社員番号は既に登録されています' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (employee_id, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at`,
      [employee_id, display_name, password_hash, role]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin create user error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user (display_name, password, role)
 */
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { display_name, password, role } = req.body;

  try {
    // Check user exists
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }
    if (password !== undefined) {
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(password_hash);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      values
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin update user error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * Activate/deactivate user
 */
router.patch('/users/:id/status', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (is_active === undefined) {
    return res.status(400).json({ error: 'is_active は必須です' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Admin update status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// ポータルリンク管理
// ============================================

/**
 * GET /api/admin/portal-links
 */
router.get('/portal-links', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portal_links ORDER BY sort_order, created_at');
    res.json({ links: result.rows });
  } catch (err) {
    logger.error('Admin list portal links error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/admin/portal-links
 */
router.post('/portal-links', async (req, res) => {
  const { title, url, icon } = req.body;
  if (!title || !url) {
    return res.status(400).json({ error: 'タイトルとURLは必須です' });
  }
  try {
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM portal_links');
    const result = await pool.query(
      `INSERT INTO portal_links (title, url, icon, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [title, url, icon || null, maxOrder.rows[0].next, req.user.id]
    );
    res.status(201).json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin create portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/admin/portal-links/:id
 */
router.put('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  const { title, url, icon, sort_order, is_active } = req.body;
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;
    if (title !== undefined) { updates.push(`title = $${paramIndex++}`); values.push(title); }
    if (url !== undefined) { updates.push(`url = $${paramIndex++}`); values.push(url); }
    if (icon !== undefined) { updates.push(`icon = $${paramIndex++}`); values.push(icon); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${paramIndex++}`); values.push(sort_order); }
    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }
    if (updates.length === 0) return res.status(400).json({ error: '更新する項目がありません' });
    values.push(id);
    const result = await pool.query(
      `UPDATE portal_links SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ link: result.rows[0] });
  } catch (err) {
    logger.error('Admin update portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/admin/portal-links/:id
 */
router.delete('/portal-links/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM portal_links WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'リンクが見つかりません' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin delete portal link error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

// ============================================
// Webhook管理
// ============================================

/**
 * GET /api/admin/webhooks
 * Webhook一覧取得
 */
router.get('/webhooks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.room_id, r.name as room_name, w.url, w.events, w.is_active, w.created_at
       FROM webhooks w
       LEFT JOIN rooms r ON r.id = w.room_id
       ORDER BY w.created_at DESC`
    );
    res.json({ webhooks: result.rows });
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

    const { dispatchWebhook } = require('../services/webhook');
    const testResult = await dispatchWebhook(webhook, payload);

    res.json({ success: testResult.ok, status: testResult.status });
  } catch (err) {
    logger.error('Admin test webhook error:', err);
    res.status(502).json({ error: 'テスト送信に失敗しました', details: err.message });
  }
});

module.exports = router;
