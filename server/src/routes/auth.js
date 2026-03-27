const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

const SALT_ROUNDS = 10;

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res) => {
  const { employee_id, display_name, password } = req.body;

  // Validation
  if (!employee_id || !display_name || !password) {
    return res.status(400).json({ error: '社員番号、表示名、パスワードは必須です' });
  }

  try {
    // Check duplicate
    const existing = await pool.query(
      'SELECT id FROM users WHERE employee_id = $1',
      [employee_id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'この社員番号は既に登録されています' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (employee_id, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, employee_id, display_name, avatar_url, status_message, is_active, created_at`,
      [employee_id, display_name, password_hash]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * POST /api/auth/login
 * Login with employee_id and password
 */
router.post('/login', async (req, res) => {
  const { employee_id, password } = req.body;

  // Validation
  if (!employee_id || !password) {
    return res.status(400).json({ error: '社員番号とパスワードは必須です' });
  }

  try {
    // Find user
    const result = await pool.query(
      'SELECT id, employee_id, display_name, avatar_url, status_message, is_active, password_hash, created_at FROM users WHERE employee_id = $1 AND is_active = true',
      [employee_id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '社員番号またはパスワードが正しくありません' });
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '社員番号またはパスワードが正しくありません' });
    }

    // Remove password_hash from response
    delete user.password_hash;

    const token = generateToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
