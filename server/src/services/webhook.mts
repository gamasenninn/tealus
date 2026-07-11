/**
 * Webhook Dispatcher
 * イベント発生時に登録済みWebhookへHTTP POSTで通知する
 */
import crypto from 'node:crypto';
import { pool } from '../db/pool.mts';
import { logger } from '../utils/logger.mts';

/** 送信先 Webhook (webhooksテーブルの行のうち送信に使うフィールド) */
interface WebhookTarget {
  url: string;
  secret?: string | null;
}

/** webhooksテーブルの行 */
interface WebhookRow extends WebhookTarget {
  id: string;
  events: string[];
  room_id: string | null;
  is_active: boolean;
}

/** 送信結果 */
interface DispatchResult {
  ok: boolean;
  status: number;
  attempts: number;
  error?: string;
}

/** fireWebhooks に渡すペイロード (room はルーム情報で補完される) */
interface WebhookPayload {
  room?: {
    name?: string | null;
    type?: string;
    member_count?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * HMAC-SHA256署名を生成する
 * @param secret - シークレットキー
 * @param body - ペイロード文字列
 * @returns 16進数の署名
 */
export function generateSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * 単一のWebhookにペイロードを送信する（テスト送信用、リトライなし）
 * @param webhook - webhooksテーブルの行
 * @param body - JSON文字列のペイロード
 */
export async function dispatchWebhook(webhook: WebhookTarget, body: string): Promise<{ ok: boolean; status: number }> {
  const headers: Record<string, string> = {
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
 * @param webhook - webhooksテーブルの行
 * @param body - JSON文字列のペイロード
 * @param opts - オプション
 * @param opts.maxRetries - 最大試行回数（デフォルト3）
 * @param opts.baseDelay - 基本遅延ms（デフォルト5000）
 */
export async function dispatchWithRetry(webhook: WebhookTarget, body: string, opts: { maxRetries?: number; baseDelay?: number } = {}): Promise<DispatchResult> {
  const maxRetries = opts.maxRetries || 3;
  const baseDelay = opts.baseDelay || 5000;

  const headers: Record<string, string> = {
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
        return { ok: false, status: 0, attempts: attempt, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // 到達不能: maxRetries >= 1 のため最終試行で必ず return する (型のための保険)
  throw new Error('dispatchWithRetry: unreachable');
}

/**
 * イベントに対応する全Webhookにペイロードを送信する
 * @param eventType - イベント種別（例: 'message.created'）
 * @param roomId - ルームID（ルーム限定Webhook用）
 * @param payload - ペイロードオブジェクト
 */
export async function fireWebhooks(eventType: string, roomId: string | null, payload: WebhookPayload): Promise<void> {
  try {
    const result = await pool.query<WebhookRow>(
      `SELECT * FROM webhooks
       WHERE is_active = true
       AND $1 = ANY(events)
       AND (room_id IS NULL OR room_id = $2)`,
      [eventType, roomId]
    );

    if (result.rows.length === 0) return;

    // ルーム情報を取得してペイロードに追加
    if (roomId && payload.room) {
      if (!payload.room.name || !payload.room.member_count) {
        const roomResult = await pool.query<{ name: string | null; type: string; member_count: number }>(
          `SELECT r.name, r.type, (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) as member_count
           FROM rooms r WHERE r.id = $1`,
          [roomId]
        );
        if (roomResult.rows.length > 0) {
          payload.room.name = payload.room.name || roomResult.rows[0].name;
          payload.room.member_count = roomResult.rows[0].member_count;
          payload.room.type = roomResult.rows[0].type;
        }
      }
      // DM ルームの場合、メンバー名をルーム名として設定
      if (!payload.room.name && payload.room.type === 'direct') {
        const membersResult = await pool.query<{ display_name: string }>(
          `SELECT u.display_name FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = $1`,
          [roomId]
        );
        if (membersResult.rows.length > 0) {
          payload.room.name = membersResult.rows.map(r => r.display_name).join(' ↔ ');
        }
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
        logger.error(`Webhook dispatch error: ${webhook.url}`, err instanceof Error ? err.message : String(err));
      });
    }
  } catch (err) {
    logger.error('fireWebhooks error:', err);
  }
}
