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

/** 秒の時刻を JST の「MM-DD HH:mm」に (ログ用) */
function fmtJst(sec: number | undefined): string {
  if (typeof sec !== 'number') return '?';
  return new Date(sec * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

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
  // ★ 改善ループ 49: 同じ鍵 (人・期限) からは同じ新しい鍵を返す。ボット (agent-server・EC窓口など) は X-Refreshed-Token を
  //   読まず古い鍵で要求し続けるので、毎回署名し直し・ログを書いていた (EC窓口は 1 日 13 万要求)
  const key = `${decoded.id}:${decoded.exp}:${authAt}`;
  const hit = refreshedCache.get(key);
  if (hit) return hit.token;
  const exp = Math.min(nowSec + TOKEN_TTL_SEC, authAt + TOKEN_MAX_AGE_SEC);
  if (exp <= decoded.exp) return null;
  const token = jwt.sign(
    { id: decoded.id, login_id: decoded.login_id, auth_at: authAt, iat: nowSec, exp },
    JWT_SECRET,
  );
  if (refreshedCache.size >= REFRESHED_CACHE_MAX) refreshedCache.clear();   // 人数 × 端末で十分小さい。溢れたら作り直すだけ
  refreshedCache.set(key, { token });
  return token;
}

/** 改善ループ 49: 「人:元の期限」→ 作った新しい鍵 (同じ鍵からは 1 回だけ作り、ログも 1 回だけ) */
const refreshedCache = new Map<string, { token: string }>();
const REFRESHED_CACHE_MAX = 1000;
/** 改善ループ 49: 延ばしたことをログに書いた鍵 (人:元の期限) */
const loggedRefresh = new Set<string>();
/** テスト用 (別のテストで作った鍵が残らないように) */
export function resetRefreshedTokenCache(): void { refreshedCache.clear(); loggedRefresh.clear(); }

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
  const cacheKey = `${decoded.id}:${decoded.exp}`;
  const firstTime = !loggedRefresh.has(cacheKey);
  const fresh = refreshTokenIfDue(decoded);
  // ★ 改善ループ 49: 延ばさない応答にも空の値を付ける。304 では届いたヘッダーだけが差し替わるので、
  //   ブラウザに保存済みの応答の古い X-Refreshed-Token を空で上書きできる (古い画面も救える。空は新旧どちらの画面も無視する)
  if (!fresh) res.setHeader('X-Refreshed-Token', '');
  if (fresh) {
    res.setHeader('X-Refreshed-Token', fresh);
    // ★ 改善ループ 48: この応答はブラウザに保存させない。保存されると、後の 304 (届いたヘッダーだけが差し替わる) で
    //   この古い鍵が見え続け、共用 PC では次の人の画面に前の人の鍵が見える (画面側でも同じ人・期限が後の鍵しか受け取らない)
    res.setHeader('Cache-Control', 'no-store');
    // ★ 延ばしたことを残す (応答のヘッダーはログに出ないので、効いているかを測れなかった)。鍵そのものは出さない
    if (firstTime) {   // ★ 同じ鍵からは 1 回だけ書く (ボットは同じ古い鍵で要求し続ける)
      if (loggedRefresh.size >= 1000) loggedRefresh.clear();
      loggedRefresh.add(cacheKey);
      const exp = (jwt.decode(fresh) as { exp?: number } | null)?.exp;
      logger.info(`[auth] 鍵を延ばしました user=${String(decoded.id).slice(0, 8)} 旧期限=${fmtJst(decoded.exp)} 新期限=${fmtJst(exp)}`);
    }
  }
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
