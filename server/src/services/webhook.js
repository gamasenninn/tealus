/**
 * Webhook Dispatcher
 * イベント発生時に登録済みWebhookへHTTP POSTで通知する
 */
const crypto = require('crypto');
const pool = require('../db/pool');
const logger = require('../utils/logger');

/**
 * 単一のWebhookにペイロードを送信する
 * @param {object} webhook - webhooksテーブルの行
 * @param {string} body - JSON文字列のペイロード
 * @returns {Promise<{ok: boolean, status: number}>}
 */
async function dispatchWebhook(webhook, body) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Tealus-Webhook/1.0',
  };

  // 署名検証ヘッダー
  if (webhook.secret) {
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
    headers['X-Tealus-Signature'] = `sha256=${signature}`;
  }

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  return { ok: response.ok, status: response.status };
}

/**
 * イベントに対応する全Webhookにペイロードを送信する
 * @param {string} eventType - イベント種別（例: 'message.created'）
 * @param {string|null} roomId - ルームID（ルーム限定Webhook用）
 * @param {object} payload - ペイロードオブジェクト
 */
async function fireWebhooks(eventType, roomId, payload) {
  try {
    const result = await pool.query(
      `SELECT * FROM webhooks
       WHERE is_active = true
       AND $1 = ANY(events)
       AND (room_id IS NULL OR room_id = $2)`,
      [eventType, roomId]
    );

    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      ...payload,
    });

    for (const webhook of result.rows) {
      dispatchWebhook(webhook, body).catch(err => {
        logger.error(`Webhook dispatch failed: ${webhook.url}`, err.message);
      });
    }
  } catch (err) {
    logger.error('fireWebhooks error:', err);
  }
}

module.exports = { dispatchWebhook, fireWebhooks };
