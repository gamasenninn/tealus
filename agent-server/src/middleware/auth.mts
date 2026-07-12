/**
 * JWT 認証ミドルウェア（Agent Server 用）
 * Tealus Server と同じ JWT_SECRET を共有し、同じトークンで認証。
 * DB ルックアップは行わない（疎結合設計）。
 */
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  console.warn('[agent-auth] JWT_SECRET not set; using insecure dev fallback. Never run like this in production.');
  return 'tealus-dev-secret-not-for-production';
})();

/**
 * JWT トークンを検証し req.user にペイロードをセット
 */
export function authenticate(req: Request, res: Response, next: NextFunction): Response | void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: '認証が必要です' });
  }

  try {
    // agent-server の Request 型には user フィールドが無いため、この middleware 内で
    // ペイロードを保持する箇所に限定してキャスト (agent-server 内で req.user を読む
    // 箇所は他に存在しない、#330 TS 移行時点調査済み)
    (req as Request & { user?: JwtPayload | string }).user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' });
  }
}
