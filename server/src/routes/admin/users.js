const logger = require('../../utils/logger');
const E = require('../../constants/errors');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../../db/pool');

const { SALT_ROUNDS } = require('../../constants/config');

const router = express.Router();

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, login_id, display_name, avatar_url, status_message, role, is_active, is_bot, last_seen_at, created_at, updated_at FROM users ORDER BY created_at'
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
  const { login_id, display_name, password, role = 'user', is_bot = false } = req.body;

  if (!login_id || !display_name || !password) {
    return res.status(400).json({ error: E.AUTH_REGISTER_REQUIRED });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE login_id = $1',
      [login_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: E.AUTH_DUPLICATE_LOGIN_ID });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (login_id, display_name, password_hash, role, is_bot)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_bot, is_active, created_at`,
      [login_id, display_name, password_hash, role, is_bot]
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
  const { display_name, password, role, is_bot } = req.body;

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
    if (is_bot !== undefined) {
      updates.push(`is_bot = $${paramIndex++}`);
      values.push(is_bot);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    updates.push(`updated_at = now()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
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
       RETURNING id, login_id, display_name, avatar_url, status_message, role, is_active, created_at, updated_at`,
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

module.exports = router;
