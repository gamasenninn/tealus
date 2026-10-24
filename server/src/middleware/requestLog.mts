import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.mts';

/**
 * API の要求を 1 行ずつ記録する (改善ループ 9 回目の B・C で「誰が」を足した)。
 *
 * - いつもの行 (debug): 方法・URL・状態・時間・利用者
 * - [http-denied] (warn): 401 / 403 / 429。誰か・どこから・どの端末か。★ 問い合わせ (?…) は残さない (鍵が乗ることがある)
 * - [change] (info): 人が何かを変えた要求 (GET 以外で成功)。誰が・どこを・どの欄を。★ 値は残さない (パスワード・本文が入る)
 *
 * ★ 応答を返したあと (finish) に書くので、認証を通った要求なら req.user が入っている
 */
const DENIED = new Set([401, 403, 429]);
// 変更の記録に載せない口: 機械の定期便 (心拍・投稿で 1 日に数千行になる) とログイン (パスワードを扱う口)、
// 日常の操作 (既読 約 500 回/日・プッシュの登録・通行証の発行。10-18 の本番ログで数えた。設定を変えるものではない)
const NOT_A_CHANGE = [
  /^\/api\/bot\//, /^\/api\/auth\//, /^\/api\/client-errors/,
  /\/read$/, /^\/api\/push\/subscribe$/, /\/app-pass$/,
];

const BOT_EDIT_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);

/** 中継が付ける「頼んだ人」の頭 8 字。形が崩れていれば null (記録に変な文字を入れない) */
function onBehalfOf(req: Request): string | null {
  const v = req.get('x-tealus-requester');
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v.slice(0, 8) : null;
}

function who(req: Request): string {
  return req.user?.id ? req.user.id.slice(0, 8) : '-';
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
  const start = Date.now();
  res.on('finish', () => {
    const url = req.originalUrl;
    if (!url.startsWith('/api/')) return;
    const ms = Date.now() - start;
    const status = res.statusCode;
    const path = url.split('?')[0];
    logger.debug(`${req.method} ${url} ${status} ${ms}ms user=${who(req)}`);

    if (DENIED.has(status)) {
      logger.warn(`[http-denied] ${status} ${req.method} ${path} user=${who(req)} ip=${req.ip ?? '-'} ua=${clip(req.headers['user-agent'], 120)}`);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
        && status >= 200 && status < 300 && !NOT_A_CHANGE.some((re) => re.test(path))) {
      if (!req.user?.is_bot) {
        logger.info(`[change] ${req.method} ${path} ${status} by=${who(req)} fields=${bodyFields(req)}`);
      } else if (BOT_EDIT_METHODS.has(req.method)) {
        // ★ 改善ループ 9 回目の D: 機械が頼まれて編集・削除したときは、頼んだ人 (中継の X-Tealus-Requester、#564) を添える。
        //   台帳 (message_edits) には機械の名前しか載らない。機械の投稿 (POST) は数が多いので残さない
        // ★ 改善ループ 14 回目: 頼まれていない機械の編集 (ボット自身の判断) も for=- で残す (10-23 に 7 回、記録 0 だった)
        logger.info(`[change] ${req.method} ${path} ${status} by=${who(req)} for=${onBehalfOf(req) ?? '-'} fields=${bodyFields(req)}`);
      }
    }
  });
  next();
}
