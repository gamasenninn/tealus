/**
 * Tealus Bot API Test
 * Bot APIを使ってメッセージを送受信するテストスクリプト
 *
 * Usage: node scripts/bot-api-test.js [room_name]
 * Example: node scripts/bot-api-test.js "田中太郎"
 *          node scripts/bot-api-test.js "Web部"
 */
const http = require('http');

const SERVER = 'http://localhost:3000';
const BOT_ID = 'Claude';
const BOT_PASS = '1234';
const TARGET_ROOM = process.argv[2] || null;

let token = null;

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const url = new URL(path, SERVER);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('🤖 Bot API テスト\n');

  // Login
  const login = await apiCall('POST', '/api/auth/login', { employee_id: BOT_ID, password: BOT_PASS });
  if (!login.token) {
    console.log('❌ ログイン失敗。BOT_IDとBOT_PASSを確認してください。');
    return;
  }
  token = login.token;
  console.log(`✅ ${login.user.display_name} でログイン\n`);

  // Get rooms
  const rooms = await apiCall('GET', '/api/bot/rooms');
  if (!rooms.rooms || rooms.rooms.length === 0) {
    console.log('⚠ 参加中のルームがありません。');
    return;
  }

  console.log('📌 参加中のルーム:');
  rooms.rooms.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.name || 'DM'} (${r.member_count}人) [${r.id}]`);
  });
  console.log('');

  // Select room
  let targetRoom;
  if (TARGET_ROOM) {
    // Match by number, name, or partial ID
    const num = parseInt(TARGET_ROOM);
    if (num >= 1 && num <= rooms.rooms.length) {
      targetRoom = rooms.rooms[num - 1];
    } else {
      targetRoom = rooms.rooms.find(r =>
        r.name === TARGET_ROOM || r.id === TARGET_ROOM || r.id.startsWith(TARGET_ROOM)
      );
    }
    if (!targetRoom) {
      console.log(`❌ ルーム「${TARGET_ROOM}」が見つかりません。番号(1〜${rooms.rooms.length})で指定してください。`);
      return;
    }
  } else {
    console.log('💡 使い方: node scripts/bot-api-test.js <番号>');
    console.log('   例: node scripts/bot-api-test.js 1');
    console.log('   例: node scripts/bot-api-test.js "Web部"');
    console.log('');
    console.log('   ルーム名を指定せず全ルームにテスト送信します...\n');

    for (const room of rooms.rooms) {
      const name = room.name || 'DM';
      console.log(`📨 「${name}」に送信中...`);
      const result = await apiCall('POST', '/api/bot/push', {
        room_id: room.id,
        content: `🤖 Bot APIテスト（${name}）: ${new Date().toLocaleTimeString('ja-JP')}`,
      });
      console.log(`   ✅ 送信成功: ${result.message?.id || 'error'}`);
    }
    console.log('\n🎉 全ルームに送信完了！');
    return;
  }

  // Send to specific room
  console.log(`📨 「${targetRoom.name || 'DM'}」に送信...`);
  const result = await apiCall('POST', '/api/bot/push', {
    room_id: targetRoom.id,
    content: `🤖 Bot APIテスト: ${new Date().toLocaleTimeString('ja-JP')} に送信しました。リアルタイムで届いていますか？`,
  });
  console.log(`   ✅ 送信成功\n`);

  // Get recent messages
  const since = new Date(Date.now() - 60000).toISOString();
  console.log('📥 直近メッセージ取得...');
  const msgs = await apiCall('GET', `/api/bot/messages?room_id=${targetRoom.id}&since=${since}`);
  msgs.messages?.forEach(m => {
    console.log(`   💬 ${m.sender_display_name}: ${m.content || '(メディア)'}`);
  });

  console.log('\n🎉 テスト完了！');
}

main().catch(console.error);
