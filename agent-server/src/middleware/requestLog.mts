/**
 * agent-server の要求を記録する (改善ループ 9 回目の B・C)。本体の server/src/middleware/requestLog.mts と同じ形。
 *
 * - [http-denied] (warn): 401 / 403 / 429。誰か・どこから・どの端末か。★ 問い合わせ (?…) は残さない
 * - [change] (info): 人が設定などを変えた要求 (GET 以外で成功)。誰が・どこを・どの欄を。★ 値は残さない
 *
 * ★ 以前は agent-server に要求の記録が無く、/cc-queue の 401 はどこにも残らなかった
 * ★ req.user は JWT の中身 (DB は引かない)。応答のあと (finish) に書くので、認証を通った要求なら入っている
 */
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.mts';

const DENIED = new Set([401, 403, 429]);
// 変更の記録に載せない口: 本体からの webhook (投稿のたびに来る)
const NOT_A_CHANGE = [/^\/webhook(\/|$)/];

function who(req: Request): string {
  const u = (req as Request & { user?: { id?: unknown } }).user;
  return u && typeof u.id === 'string' ? u.id.slice(0, 8) : '-';
}

function clip(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : '';
  return (s.length > max ? s.slice(0, max) + '…' : s).replace(/\s+/g, ' ') || '-';
}

function bodyFields(req: Request): string {
  const b = req.body as unknown;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return '-';
  const keys = Object.keys(b as Record<string, unknown>);
  return keys.length > 0 ? keys.join(',') : '-';
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    const status = res.statusCode;
    const path = req.originalUrl.split('?')[0];
    if (DENIED.has(status)) {
      logger.warn(`[http-denied] ${status} ${req.method} ${path} user=${who(req)} ip=${req.ip ?? '-'} ua=${clip(req.headers['user-agent'], 120)}`);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
        && status >= 200 && status < 300 && !NOT_A_CHANGE.some((re) => re.test(path))) {
      logger.info(`[change] ${req.method} ${path} ${status} by=${who(req)} fields=${bodyFields(req)}`);
    }
  });
  next();
}
