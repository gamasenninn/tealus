/**
 * Webhook Dispatcher
 * イベント発生時に登録済みWebhookへHTTP POSTで通知する
 */
const crypto = require('crypto');
const pool = require('../db/pool');
const logger = require('../utils/logger');

/**
 * HMAC-SHA256署名を生成する
 * @param {string} secret - シークレットキー
 * @param {string} body - ペイロード文字列
 * @returns {string} 16進数の署名
 */
function generateSignature(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * 単一のWebhookにペイロードを送信する（テスト送信用、リトライなし）
 * @param {object} webhook - webhooksテーブルの行
 * @param {string} body - JSON文字列のペイロード
 * @returns {Promise<{ok: boolean, status: number}>}
 */
async function dispatchWebhook(webhook, body) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Tealus-Webhook/1.0',
  };

  if (webhook.secret) {
    headers['X-Tealus-Signature'] = `sha256=${generateSignature(webhook.secret, body)}`;
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
 * リトライ付きWebhook送信
 * 5xx/ネットワークエラー時は指数バックオフでリトライ
 * 4xxはクライアントエラーなのでリトライしない
 *
 * @param {object} webhook - webhooksテーブルの行
 * @param {string} body - JSON文字列のペイロード
 * @param {object} opts - オプション
 * @param {number} opts.maxRetries - 最大試行回数（デフォルト3）
 * @param {number} opts.baseDelay - 基本遅延ms（デフォルト5000）
 * @returns {Promise<{ok: boolean, status: number, attempts: number}>}
 */
async function dispatchWithRetry(webhook, body, opts = {}) {
  const maxRetries = opts.maxRetries || 3;
  const baseDelay = opts.baseDelay || 5000;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Tealus-Webhook/1.0',
  };

  if (webhook.secret) {
    headers['X-Tealus-Signature'] = `sha256=${generateSignature(webhook.secret, body)}`;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return { ok: true, status: response.status, attempts: attempt };
      }

      // 4xx はクライアントエラー → リトライしない
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, status: response.status, attempts: attempt };
      }

      // 5xx はリトライ対象
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(3, attempt - 1); // 5s → 15s → 45s
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return { ok: false, status: response.status, attempts: attempt };
      }
    } catch (err) {
      // ネットワークエラー → リトライ
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(3, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return { ok: false, status: 0, attempts: attempt, error: err.message };
      }
    }
  }
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

    if (result.rows.length === 0) return;

    // ルーム名を取得してペイロードに追加
    if (roomId && payload.room && !payload.room.name) {
      const roomResult = await pool.query('SELECT name FROM rooms WHERE id = $1', [roomId]);
      if (roomResult.rows.length > 0) {
        payload.room.name = roomResult.rows[0].name;
      }
    }

    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      ...payload,
    });

    for (const webhook of result.rows) {
      dispatchWithRetry(webhook, body).then(result => {
        if (!result.ok) {
          logger.error(`Webhook failed: ${webhook.url} (status: ${result.status}, attempts: ${result.attempts})`);
        } else if (result.attempts > 1) {
          logger.info(`Webhook succeeded after retry: ${webhook.url} (attempts: ${result.attempts})`);
        }
      }).catch(err => {
        logger.error(`Webhook dispatch error: ${webhook.url}`, err.message);
      });
    }
  } catch (err) {
    logger.error('fireWebhooks error:', err);
  }
}

module.exports = { dispatchWebhook, dispatchWithRetry, generateSignature, fireWebhooks };
