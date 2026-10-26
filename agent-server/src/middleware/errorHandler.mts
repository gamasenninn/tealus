/**
 * 想定外の失敗 (next(err) / ルートで投げられた例外) の受け口。app の一番最後に付ける。
 *
 * ★ 本体の server/src/middleware/errorHandler.mts (#603) と同じ形 (セキュリティチェックループ 1 回目、2026-10-26)。
 *   受け口が無いと Express の既定の返事になり、NODE_ENV が無いと本文にスタック (中のパス) が入る。
 *   NODE_ENV に頼らず、中身は記録にだけ残し、返事は決まった文にする
 * ★ 状態の番号を持つ失敗 (本文が大きすぎる 413・JSON が壊れている 400 など、body-parser が付ける) は番号を保つ
 */
import type { ErrorRequestHandler } from 'express';
import { logger } from '../lib/logger.mts';

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) { next(err); return; }   // 返し始めていたら Express に任せて接続を閉じてもらう
  const raw = (err as { status?: unknown; statusCode?: unknown } | null)?.status ?? (err as { statusCode?: unknown } | null)?.statusCode;
  const status = typeof raw === 'number' && raw >= 400 && raw <= 599 ? raw : 500;
  if (status >= 500) logger.error(`[error] ${req.method} ${req.path} ${status}`, err);
  else logger.warn(`[http] ${req.method} ${req.path} ${status}: ${err instanceof Error ? err.message : String(err)}`);
  res.status(status).json({ error: status >= 500 ? 'サーバーで問題が起きました' : 'リクエストを受け付けられませんでした' });
};
