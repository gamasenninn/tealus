/**
 * Tealus Bot - Polling Example
 * 定期的にメッセージをチェックして返信するシンプルなBot
 *
 * Usage: node scripts/bot-poll.js
 */
const http = require('http');

const SERVER = 'http://localhost:3000';
const BOT_ID = 'Claude';
const BOT_PASS = '1234';
const POLL_INTERVAL = 3000; // 3秒ごと

let token = null;
let botUserId = null;
let lastChecked = {};  // roomId -> lastMessageId

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const url = new URL(path, SERVER);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method, headers
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function generateReply(msg) {
  const text = (msg.content || '').toLowerCase();

  if (text.includes('こんにちは') || text.includes('hello')) {
    return `こんにちは、${msg.sender_display_name}さん！Tealus Botです。何かお手伝いできることはありますか？`;
  }
  if (text.includes('ありがとう')) {
    return 'どういたしまして！';
  }
  if (text.includes('時間') || text.includes('何時')) {
    return `現在の時刻は ${new Date().toLocaleTimeString('ja-JP')} です。`;
  }
  if (text.includes('?') || text.includes('？')) {
    return `なるほど、「${msg.content}」ですね。面白い質問です！`;
  }

  return null;
}

async function pollAndReply() {
  try {
    const roomsData = await apiCall('GET', '/api/rooms');
    if (!roomsData.rooms) return;

    for (const room of roomsData.rooms) {
      const msgs = await apiCall('GET', `/api/rooms/${room.id}/messages?limit=5`);
      if (!msgs.messages || msgs.messages.length === 0) continue;

      // Messages are newest-first from API, reverse to process oldest first
      const messages = msgs.messages.reverse();
      const lastId = lastChecked[room.id];

      for (const msg of messages) {
        // Skip own messages
        if (msg.sender_id === botUserId) continue;
        // Skip already seen
        if (lastId && msg.created_at <= lastId) continue;

        console.log(`💬 [${room.name || room.partner_display_name}] ${msg.sender_display_name}: ${msg.content || '(メディア)'}`);

        const reply = generateReply(msg);
        if (reply) {
          await apiCall('POST', `/api/rooms/${room.id}/messages`, { content: reply });
          console.log(`🤖 Reply: ${reply}`);
        }
      }

      // Remember last message timestamp
      lastChecked[room.id] = messages[messages.length - 1].created_at;
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

async function main() {
  console.log('🤖 Tealus Bot starting...');

  // Login
  const login = await apiCall('POST', '/api/auth/login', { login_id: BOT_ID, password: BOT_PASS });
  token = login.token;
  botUserId = login.user.id;
  console.log(`✅ Logged in as ${login.user.display_name}`);

  // Initialize last checked timestamps
  const roomsData = await apiCall('GET', '/api/rooms');
  for (const room of roomsData.rooms) {
    const msgs = await apiCall('GET', `/api/rooms/${room.id}/messages?limit=1`);
    if (msgs.messages && msgs.messages.length > 0) {
      lastChecked[room.id] = msgs.messages[0].created_at;
    }
  }

  console.log(`📌 Monitoring ${roomsData.rooms.length} rooms`);
  console.log(`⏱  Polling every ${POLL_INTERVAL / 1000}s`);
  console.log('   (Ctrl+C to stop)\n');

  // Start polling
  setInterval(pollAndReply, POLL_INTERVAL);
}

main().catch(console.error);
