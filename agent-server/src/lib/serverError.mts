import type { Request, Response } from 'express';
import { logger } from './logger.mts';

/**
 * 想定外の失敗を 500 で返す。中身 (ファイルの場所など) は記録にだけ残し、返事は決まった文にする
 * (セキュリティチェックループ 2 回目、2026-10-26)。★ 以前は err.message をそのまま返していた
 */
export function sendServerError(req: Request, res: Response, err: unknown): void {
  logger.error(`[error] ${req.method} ${req.baseUrl}${req.path} 500: ${err instanceof Error ? err.message : String(err)}`);
  res.status(500).json({ error: 'サーバーで問題が起きました' });
}
