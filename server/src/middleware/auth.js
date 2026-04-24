const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  console.warn('[auth] JWT_SECRET not set; using insecure dev fallback. Never run like this in production.');
  return 'tealus-dev-secret-not-for-production';
})();

/**
 * Generate JWT token for a user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, employee_id: user.employee_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * JWT authentication middleware
 * Sets req.user with the authenticated user's info
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, employee_id, display_name, avatar_url, status_message, role, is_active, created_at FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ユーザーが見つかりません' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

/**
 * Admin authorization middleware
 * Must be used after authenticate
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}

module.exports = { generateToken, authenticate, requireAdmin, JWT_SECRET };
