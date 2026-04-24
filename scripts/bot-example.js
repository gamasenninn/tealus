/**
 * Tealus Bot Example
 * Socket.IO経由でリアルタイムに会話するAIボットのサンプル
 *
 * Usage: node scripts/bot-example.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });

const { io } = require('socket.io-client');
const http = require('http');

const BOT_ID = 'Claude';
const BOT_PASS = '1234';
const SERVER = 'http://localhost:3000';

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const url = new URL(path, SERVER);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method, headers
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Login
  console.log('🤖 Logging in as', BOT_ID, '...');
  const login = await apiCall('POST', '/api/auth/login', { login_id: BOT_ID, password: BOT_PASS });
  const token = login.token;
  const botUserId = login.user.id;
  console.log('✅ Logged in as', login.user.display_name);

  // 2. Connect Socket.IO
  const socket = io(SERVER, { auth: { token } });

  socket.on('connect', async () => {
    console.log('🔌 Socket connected:', socket.id);

    // 3. Join all rooms
    const roomsData = await apiCall('GET', '/api/rooms', null, token);
    for (const room of roomsData.rooms) {
      socket.emit('room:join', room.id);
      const name = room.type === 'group' ? room.name : room.partner_display_name;
      console.log('📌 Joined room:', name);
    }

    console.log('');
    console.log('🤖 Bot is ready! Waiting for messages...');
    console.log('   (Ctrl+C to stop)');
    console.log('');
  });

  // 4. Listen for messages
  socket.on('message:new', async (msg) => {
    // Ignore own messages
    if (msg.sender_id === botUserId) return;

    console.log(`💬 ${msg.sender_display_name}: ${msg.content || '(メディア)'}`);

    // Simple auto-reply logic
    const reply = generateReply(msg);
    if (reply) {
      // Typing indicator
      socket.emit('typing:start', msg.room_id);
      await new Promise(r => setTimeout(r, 1000)); // Simulate thinking
      socket.emit('typing:stop', msg.room_id);

      // Send reply
      socket.emit('message:send', {
        room_id: msg.room_id,
        content: reply,
        type: 'text',
      });
      console.log(`🤖 Reply: ${reply}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected');
  });
}

/**
 * Simple reply logic — replace with AI (Claude API, etc.) for real use
 */
function generateReply(msg) {
  const text = (msg.content || '').toLowerCase();

  if (msg.type === 'voice') {
    return '🎤 音声メッセージを受け取りました！文字起こしが完了したら内容を確認しますね。';
  }

  if (text.includes('こんにちは') || text.includes('hello')) {
    return `こんにちは、${msg.sender_display_name}さん！何かお手伝いできることはありますか？`;
  }

  if (text.includes('ありがとう') || text.includes('thanks')) {
    return 'どういたしまして！いつでもお声がけください。';
  }

  if (text.includes('時間') || text.includes('何時')) {
    return `現在の時刻は ${new Date().toLocaleTimeString('ja-JP')} です。`;
  }

  if (text.includes('天気')) {
    return '申し訳ありません、天気情報にはまだアクセスできません。将来のアップデートをお楽しみに！';
  }

  if (text.includes('?') || text.includes('？')) {
    return 'いい質問ですね！現在はシンプルな応答しかできませんが、将来的にはAI APIと連携して高度な回答ができるようになります。';
  }

  // Default: echo with acknowledgment
  return null; // Don't reply to everything
}

main().catch(console.error);
