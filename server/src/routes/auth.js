const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const crypto = require('crypto');
const pool = require('../db/pool');
const { generateToken, authenticate } = require('../middleware/auth');

const AVATAR_DIR = path.join(__dirname, '../../../media/avatars');
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = express.Router();

const { SALT_ROUNDS } = require('../constants/config');

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
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at`,
      [employee_id, display_name, password_hash]
    );

    const user = result.rows[0];
    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    logger.error('Register error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
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
      'SELECT id, employee_id, display_name, avatar_url, status_message, role, is_active, password_hash, created_at FROM users WHERE employee_id = $1 AND is_active = true',
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
    logger.error('Login error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

/**
 * PUT /api/auth/profile
 * Update own display_name and/or status_message
 */
router.put('/profile', authenticate, async (req, res) => {
  const { display_name, status_message } = req.body;
  const userId = req.user.id;

  const updates = [];
  const values = [];
  let idx = 1;

  if (display_name !== undefined) {
    updates.push(`display_name = $${idx++}`);
    values.push(display_name);
  }
  if (status_message !== undefined) {
    updates.push(`status_message = $${idx++}`);
    values.push(status_message);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: '更新する項目がありません' });
  }

  updates.push('updated_at = now()');
  values.push(userId);

  try {
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at`,
      values
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Profile update error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/auth/avatar
 * Upload own avatar image
 */
router.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '画像ファイルが添付されていません' });
  }

  const avatarUrl = `avatars/${req.file.filename}`;

  try {
    const result = await pool.query(
      `UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2
       RETURNING id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at`,
      [avatarUrl, req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error('Avatar upload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/auth/password
 * Change own password (requires current password)
 */
router.put('/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: '現在のパスワードと新しいパスワードは必須です' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '現在のパスワードが正しくありません' });
    }

    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, req.user.id]);

    res.json({ message: 'パスワードを変更しました' });
  } catch (err) {
    logger.error('Password change error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
