/**
 * Webhook受信エンドポイント
 */
import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import { handleWebhook } from './handler.mts';
import type { WebhookPayload } from '../types.mts';

interface WebhookRouterOptions {
  secret: string;
  handle: (body: WebhookPayload) => Promise<void>;
}

/** 署名が鍵で作られたものか。長さが違う・形が崩れているものは false (timingSafeEqual が投げないように先に弾く) */
function signatureMatches(secret: string, body: unknown, signature: unknown): boolean {
  if (typeof signature !== 'string') return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * ★ 鍵が設定されているなら、署名の無い・合わない便は受け取らない (2026-10-01)。
 *   以前は「署名が付いているときだけ」検査していたので、署名を付けなければ素通りだった。
 * ★ 鍵が無い設定は以前どおり受け取る (採用者の既存の設定を黙って止めない)。起動時に警告を出す
 */
export function createWebhookRouter({ secret, handle }: WebhookRouterOptions) {
  const router = express.Router();

  /**
   * POST /webhook/tealus
   * Tealus Serverからの Webhook受信
   */
  router.post('/tealus', (req: Request, res: Response) => {
    if (secret && !signatureMatches(secret, req.body, req.headers['x-tealus-signature'])) {
      logger.warn('Webhook signature missing or mismatch');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 即応答（処理はバックグラウンド）
    res.json({ ok: true });

    // バックグラウンドで処理
    handle(req.body as WebhookPayload).catch(err => {
      logger.error(`Webhook handler error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  return router;
}

if (!config.WEBHOOK_SECRET) {
  logger.warn('WEBHOOK_SECRET が未設定です。webhook の署名を検査していません (docs/setup-ai-agent.md)');
}

export const router = createWebhookRouter({ secret: config.WEBHOOK_SECRET, handle: handleWebhook });
