/**
 * Tealus Bot API クライアント
 * Agent Server から Tealus Server へのHTTP通信
 */
const fetch = require('node-fetch');
const config = require('../config');
const logger = require('./logger');

let token = null;
let botUser = null;

function getBotUserId() {
  return botUser?.id;
}

/**
 * Bot認証してトークンを取得
 */
async function login() {
  if (token) return { token, user: botUser };

  const res = await fetch(`${config.TEALUS_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login_id: config.TEALUS_BOT_ID,
      password: config.TEALUS_BOT_PASS,
    }),
  });

  const data = await res.json();
  if (!data.token) {
    throw new Error(`Bot login failed: ${data.error || 'Unknown error'}`);
  }

  token = data.token;
  botUser = data.user;
  logger.info(`Bot logged in as ${config.TEALUS_BOT_ID}`);
  return { token, user: botUser };
}

/**
 * 認証付きリクエスト
 */
async function request(method, path, body = null) {
  const { token: t } = await login();
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${t}`,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${config.TEALUS_API_URL}/api${path}`, options);
  return res.json();
}

/**
 * ルームにメッセージ送信
 */
async function pushMessage(roomId, content) {
  const result = await request('POST', '/bot/push', { room_id: roomId, content });

  // TTS 読み上げ（fire-and-forget — メッセージ送信をブロックしない）
  try {
    const { speakMessage } = require('./ttsSpeak');
    speakMessage(roomId, content);
  } catch (err) {
    // TTS エラーはメッセージ送信に影響させない
    logger.debug(`[TTS] skip: ${err.message}`);
  }

  return result;
}

/**
 * ルームにステータスを通知（typing-indicator風の一時表示）
 */
async function pushStatus(roomId, status, message = '') {
  return request('POST', '/bot/status', { room_id: roomId, status, message });
}

/**
 * ルームに画像メッセージ送信
 */
async function pushImage(roomId, buffer, filename, content = '') {
  const { token: t } = await login();
  const FormData = require('form-data');
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
 * @param {string} roomId
 * @param {Buffer} buffer
 * @param {string} filename - file name (拡張子付き、ex: 'ocr_result.txt')
 * @param {string} mimeType - 'text/plain', 'application/pdf', 等
 * @param {string} content - optional 添付メッセージ text
 */
async function pushFile(roomId, buffer, filename, mimeType, content = '') {
  const { token: t } = await login();
  const FormData = require('form-data');
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
async function getMessages(roomId, limit = 20) {
  return request('GET', `/bot/messages?room_id=${roomId}&limit=${limit}`);
}

/**
 * 参加中のルーム一覧
 */
async function getRooms() {
  return request('GET', '/bot/rooms');
}

/**
 * ルームに参加
 */
async function joinRoom(roomId) {
  return request('POST', `/bot/rooms/${roomId}/join`);
}

/**
 * メッセージを既読にする
 */
async function markRead(messageIds) {
  return request('POST', '/bot/mark-read', { message_ids: messageIds });
}

/**
 * TTS_PROVIDER=browser 時に server へ TTS テキスト発話を依頼。
 * Server が Socket.IO で room に 'tts:speak' イベントを emit し、
 * 各 client が Web Speech API で発声する。
 */
async function pushTtsSpeak(roomId, text) {
  return request('POST', '/bot/tts-speak', { room_id: roomId, text });
}

/**
 * TTS_PROVIDER=aivis-cloud 時の新配信経路 (#189)。
 * agent-server で合成済みの WAV を server に POST し、server が Socket.IO で
 * room に 'tts:audio' イベント (URL) を emit する。各 client は <audio> で再生。
 * mediasoup を経由しないので rtc-server 不要。
 */
async function pushTtsAudio(roomId, wavBuffer) {
  const { token: t } = await login();
  const FormData = require('form-data');
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

module.exports = {
  login,
  getBotUserId,
  pushMessage,
  pushStatus,
  pushImage,
  pushFile,
  getMessages,
  getRooms,
  joinRoom,
  markRead,
  pushTtsSpeak,
  pushTtsAudio,
};
