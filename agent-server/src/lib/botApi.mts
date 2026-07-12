/**
 * Tealus Bot API クライアント
 * Agent Server から Tealus Server へのHTTP通信
 */
import fetch, { Response } from 'node-fetch';
import FormData from 'form-data';
import * as config from '../config.mts';
import { logger } from './logger.mts';
import * as botSendThrottle from './botSendThrottle.mts';
import { speakMessage } from './ttsSpeak.mts';

/**
 * #292 SPIKE safety: bot 送信 throttle check 共通化。
 * checkAndRecord で window count + soft trip + hard cap を一括判定。
 * - hard cap 抵触 → throw (= caller 側で catch、send 自体 abort)
 * - soft trip 初回 → warn log (= subsequent call は handler.js が runtime で旧挙動 fallback)
 * @param roomId - log context 用
 * @param kind - 'message' / 'image' / 'file' / 'tts-audio'
 */
function _throttleCheck(roomId: string, kind: string): void {
  const r = botSendThrottle.checkAndRecord();
  if (!r.ok) {
    logger.error(`[SPIKE safety] HARD CAP (${botSendThrottle.HARD_CAP}/${botSendThrottle.WINDOW_MS / 1000}s) exceeded — rejecting ${kind} send to ${roomId} (windowCount=${r.windowCount})`);
    throw new Error(`Bot send hard cap exceeded (${r.windowCount}/${botSendThrottle.HARD_CAP} in ${botSendThrottle.WINDOW_MS / 1000}s)`);
  }
  if (r.justTripped) {
    logger.warn(`[SPIKE safety] SOFT TRIP (${botSendThrottle.SPIKE_TRIP_THRESHOLD}/${botSendThrottle.WINDOW_MS / 1000}s reached) — cross-room delegation disabled at runtime, restart agent-server to reset (windowCount=${r.windowCount})`);
  }
}

interface BotUser {
  id: string;
  [key: string]: unknown;
}

let token: string | null = null;
let botUser: BotUser | null = null;

export function getBotUserId(): string | undefined {
  return botUser?.id;
}

// #303: bot JWT 失効時に cache を破棄して再ログインさせるため
function _clearAuth(): void {
  token = null;
  botUser = null;
}

interface LoginResult {
  token: string;
  user: BotUser;
}

/**
 * Bot認証してトークンを取得
 */
export async function login(): Promise<LoginResult> {
  if (token) return { token, user: botUser as BotUser };

  const res = await fetch(`${config.TEALUS_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login_id: config.TEALUS_BOT_ID,
      password: config.TEALUS_BOT_PASS,
    }),
  });

  const data = await res.json() as { token?: string; user?: BotUser; error?: string };
  if (!data.token) {
    throw new Error(`Bot login failed: ${data.error || 'Unknown error'}`);
  }

  token = data.token;
  botUser = data.user as BotUser;
  logger.info(`Bot logged in as ${config.TEALUS_BOT_ID}`);
  return { token, user: botUser };
}

/**
 * 認証付きリクエスト
 */
async function _doRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const { token: t } = await login();
  const options: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${t}`,
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetch(`${config.TEALUS_API_URL}/api${path}`, options);
}

/**
 * 認証付きリクエスト (#303)
 *
 * 旧実装は res.ok を見ず res.json() を返していたため、/bot/push 等の失敗を握り潰し、
 * agent-server が「sent」とログするのに実際は届かない事故を招いていた。
 * - 2xx: 従来どおり JSON を返す
 * - 401: bot JWT 失効とみなし token cache を破棄して 1 回だけ再ログイン retry
 * - 非2xx (401 retry 後含む): method/path/status/body を error log し、status/body 付き Error を throw
 */
async function request<T = unknown>(method: string, path: string, body: unknown = null): Promise<T> {
  let res = await _doRequest(method, path, body);

  // 401 → token 失効。cache を破棄して 1 回だけ再ログイン retry (直線・再入なし)
  if (res.status === 401) {
    logger.warn(`[botApi] 401 on ${method} ${path} — clearing bot token and re-logging in (retry once)`);
    _clearAuth();
    res = await _doRequest(method, path, body);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.error(`[botApi] ${method} ${path} -> ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    const err = new Error(`Bot API ${method} ${path} failed: ${res.status} ${res.statusText}`) as Error & { status?: number; body?: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return res.json() as Promise<T>;
}

/**
 * ルームにメッセージ送信
 */
export async function pushMessage(roomId: string, content: string): Promise<unknown> {
  _throttleCheck(roomId, 'message');
  const result = await request('POST', '/bot/push', { room_id: roomId, content });

  // TTS 読み上げ（fire-and-forget — メッセージ送信をブロックしない）
  try {
    speakMessage(roomId, content);
  } catch (err) {
    // TTS エラーはメッセージ送信に影響させない
    logger.debug(`[TTS] skip: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * ルームにステータスを通知（typing-indicator風の一時表示）
 */
export async function pushStatus(roomId: string, status: string, message: string = ''): Promise<unknown> {
  return request('POST', '/bot/status', { room_id: roomId, status, message });
}

/**
 * ルームに画像メッセージ送信
 */
export async function pushImage(roomId: string, buffer: Buffer, filename: string, content: string = ''): Promise<unknown> {
  _throttleCheck(roomId, 'image');
  const { token: t } = await login();
  const form = new FormData();
  form.append('room_id', roomId);
  form.append('image', buffer, { filename, contentType: 'image/png' });
  if (content) form.append('content', content);

  const res = await fetch(`${config.TEALUS_API_URL}/api/bot/push-image`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${t}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  return res.json();
}

/**
 * ルームに任意 file を送信 (#244)
 *
 * mime auto detect、text / pdf 等の attached file 用。
 * image / video も使えるが、image は pushImage が thumbnail / dimensions も処理するので推奨。
 *
 * @param filename - file name (拡張子付き、ex: 'ocr_result.txt')
 * @param mimeType - 'text/plain', 'application/pdf', 等
 * @param content - optional 添付メッセージ text
 */
export async function pushFile(roomId: string, buffer: Buffer, filename: string, mimeType: string, content: string = ''): Promise<unknown> {
  _throttleCheck(roomId, 'file');
  const { token: t } = await login();
  const form = new FormData();
  form.append('room_id', roomId);
  form.append('file', buffer, { filename, contentType: mimeType });
  if (content) form.append('content', content);

  const res = await fetch(`${config.TEALUS_API_URL}/api/bot/push-file`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${t}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  return res.json();
}

/**
 * ルームのメッセージ履歴を取得
 */
export async function getMessages(roomId: string, limit: number = 20): Promise<unknown> {
  return request('GET', `/bot/messages?room_id=${roomId}&limit=${limit}`);
}

/**
 * 参加中のルーム一覧
 */
export async function getRooms(): Promise<{ rooms?: Array<{ id: string; name: string }> }> {
  return request('GET', '/bot/rooms') as Promise<{ rooms?: Array<{ id: string; name: string }> }>;
}

/**
 * ルームに参加
 */
export async function joinRoom(roomId: string): Promise<unknown> {
  return request('POST', `/bot/rooms/${roomId}/join`);
}

/**
 * 指定 user が room のメンバーか確認する (#282: 委譲の権限チェック用)
 * bot 自身が非メンバーのルームは server 側で 403 → request が throw する。
 */
export async function isRoomMember(roomId: string, userId: string): Promise<boolean> {
  const r = await request<{ is_member: boolean }>('GET', `/bot/rooms/${roomId}/membership?user_id=${encodeURIComponent(userId)}`);
  return r.is_member === true;
}

/**
 * メッセージを既読にする
 */
export async function markRead(messageIds: string[]): Promise<unknown> {
  return request('POST', '/bot/mark-read', { message_ids: messageIds });
}

/**
 * TTS_PROVIDER=browser 時に server へ TTS テキスト発話を依頼。
 * Server が Socket.IO で room に 'tts:speak' イベントを emit し、
 * 各 client が Web Speech API で発声する。
 */
export async function pushTtsSpeak(roomId: string, text: string): Promise<unknown> {
  return request('POST', '/bot/tts-speak', { room_id: roomId, text });
}

/**
 * TTS_PROVIDER=aivis-cloud 時の新配信経路 (#189)。
 * agent-server で合成済みの WAV を server に POST し、server が Socket.IO で
 * room に 'tts:audio' イベント (URL) を emit する。各 client は <audio> で再生。
 * mediasoup を経由しないので rtc-server 不要。
 */
export async function pushTtsAudio(roomId: string, wavBuffer: Buffer): Promise<unknown> {
  const { token: t } = await login();
  const form = new FormData();
  form.append('room_id', roomId);
  form.append('audio', wavBuffer, { filename: 'tts.wav', contentType: 'audio/wav' });

  const res = await fetch(`${config.TEALUS_API_URL}/api/bot/tts-audio`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${t}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tts-audio POST failed: ${res.status} ${text}`);
  }
  return res.json();
}
