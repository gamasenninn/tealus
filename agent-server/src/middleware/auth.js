/**
 * JWT 認証ミドルウェア（Agent Server 用）
 * Tealus Server と同じ JWT_SECRET を共有し、同じトークンで認証。
 * DB ルックアップは行わない（疎結合設計）。
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'tealus-dev-secret';

/**
 * JWT トークンを検証し req.user にペイロードをセット
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}

module.exports = { authenticate };
