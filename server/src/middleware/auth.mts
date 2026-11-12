import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.mts';
import { isAdmin } from '../utils/permissions.mts';
import type { AuthUser } from '../types.mts';
import { SERVER_ERROR } from '../constants/errors.mts';
import { logger } from '../utils/logger.mts';
import { errorText } from '../utils/logFormat.mts';

export const JWT_SECRET = (() => {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set in production');
  }
  console.warn('[auth] JWT_SECRET not set; using insecure dev fallback. Never run like this in production.');
  return 'tealus-dev-secret-not-for-production';
})();

const DAY_SEC = 24 * 60 * 60;
/** 1 本の鍵の長さ */
const TOKEN_TTL_SEC = 7 * DAY_SEC;
/** ★ 最初のログインから、延ばしても超えない上限 (2026-11-12 小野さん判断、docs/05 §5) */
const TOKEN_MAX_AGE_SEC = 30 * DAY_SEC;

/**
 * Generate JWT token for a user (ログインのとき)。
 * ★ auth_at = 最初にログインした時刻 (秒)。延ばしても引き継ぎ、ここから 30 日で入り直しになる
 */
export function generateToken(user: Pick<AuthUser, 'id' | 'login_id'>): string {
  return jwt.sign(
    { id: user.id, login_id: user.login_id, auth_at: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_SEC }
  );
}

interface VerifiedClaims { id: string; login_id?: string; iat?: number; exp?: number; auth_at?: number }

/**
 * 使っている間に延ばす (2026-11-12、docs/05 §5)。残りが半分を切っていれば新しい鍵を返し、そうでなければ null。
 * ★ 期限は「今から 7 日」と「auth_at から 30 日」の早い方。今の期限より延びないなら返さない
 * ★ auth_at の無い古い鍵は iat を最初のログインとみなす (移行の日に入り直しは起きない)
 */
export function refreshTokenIfDue(decoded: VerifiedClaims, nowSec: number = Math.floor(Date.now() / 1000)): string | null {
  if (typeof decoded.exp !== 'number') return null;
  if (decoded.exp - nowSec > TOKEN_TTL_SEC / 2) return null;
  const authAt = typeof decoded.auth_at === 'number' ? decoded.auth_at : decoded.iat;
  if (typeof authAt !== 'number') return null;
  const exp = Math.min(nowSec + TOKEN_TTL_SEC, authAt + TOKEN_MAX_AGE_SEC);
  if (exp <= decoded.exp) return null;
  return jwt.sign(
    { id: decoded.id, login_id: decoded.login_id, auth_at: authAt, iat: nowSec, exp },
    JWT_SECRET,
  );
}

/**
 * JWT authentication middleware
 * Sets req.user with the authenticated user's info
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }

  const token = authHeader.split(' ')[1];

  let decoded: VerifiedClaims;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as VerifiedClaims;
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' });
  }

  // ★ DB の失敗は 500 (401 にしない)。401 だと画面は鍵が切れたと見てログイン画面へ落とす
  //   (2026-10-29 19:45、migrate 前の起動で SELECT が 25 秒失敗し、利用者がログイン画面へ落ちた)
  let result;
  try {
    result = await pool.query<AuthUser>(
      'SELECT id, login_id, display_name, avatar_url, status_message, role, is_active, is_bot, notification_sound, must_change_password, created_at FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
  } catch (err) {
    logger.error(`[auth] ユーザーの読み込みに失敗: ${errorText(err)}`);   // ★ 改善ループ 42: console ではログファイルに残らなかった
    return res.status(500).json({ error: SERVER_ERROR });
  }

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'ユーザーが見つかりません' });
  }

  req.user = result.rows[0];
  // ★ 使っている間に延ばす (2026-11-12、docs/05 §5)。画面は api.request でこのヘッダーを受けて鍵を差し替える。
  //   ヘッダーを読まない相手 (ボット等) には無害 (今の鍵はそのまま期限まで使える)
  const fresh = refreshTokenIfDue(decoded);
  if (fresh) res.setHeader('X-Refreshed-Token', fresh);
  next();
}

/**
 * Admin authorization middleware
 * Must be used after authenticate
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): Response | void {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: '管理者権限が必要です' });
  }
  next();
}
