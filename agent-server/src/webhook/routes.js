/**
 * Webhook受信エンドポイント
 */
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../lib/logger');
const { handleWebhook } = require('./handler');

const router = express.Router();

/**
 * POST /webhook/tealus
 * Tealus Serverからの Webhook受信
 */
router.post('/tealus', (req, res) => {
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
    logger.error(`Webhook handler error: ${err.message}`);
  });
});

module.exports = router;
