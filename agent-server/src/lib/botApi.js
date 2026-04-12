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
      employee_id: config.TEALUS_BOT_ID,
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
  return request('POST', '/bot/push', { room_id: roomId, content });
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

module.exports = {
  login,
  getBotUserId,
  pushMessage,
  getMessages,
  getRooms,
  joinRoom,
  markRead,
};
