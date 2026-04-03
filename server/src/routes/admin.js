const E = require('../constants/errors');
const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

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
    console.error('Admin list users error:', err);
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
    console.error('Admin create user error:', err);
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
    console.error('Admin update user error:', err);
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
    console.error('Admin update status error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
