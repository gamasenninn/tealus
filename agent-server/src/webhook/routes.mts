/**
 * Webhook受信エンドポイント
 */
import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import * as config from '../config.mts';
import { logger } from '../lib/logger.mts';
import { handleWebhook } from './handler.mts';

export const router = express.Router();

/**
 * POST /webhook/tealus
 * Tealus Serverからの Webhook受信
 */
router.post('/tealus', (req: Request, res: Response) => {
  // 署名検証
  if (config.WEBHOOK_SECRET) {
    const signature = req.headers['x-tealus-signature'];
    if (signature) {
      const expected = crypto.createHmac('sha256', config.WEBHOOK_SECRET)
        .update(JSON.stringify(req.body)).digest('hex');
      if (signature !== `sha256=${expected}`) {
        logger.warn('Webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  // 即応答（処理はバックグラウンド）
  res.json({ ok: true });

  // バックグラウンドで処理
  handleWebhook(req.body).catch(err => {
    logger.error(`Webhook handler error: ${err instanceof Error ? err.message : String(err)}`);
  });
});
