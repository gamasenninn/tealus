/**
 * Tealus Bot API Test
 * Bot APIを使ってメッセージを送受信するテストスクリプト
 *
 * Usage: node scripts/bot-api-test.ts [room_name]
 * Example: node scripts/bot-api-test.ts "田中太郎"
 *          node scripts/bot-api-test.ts "Web部"
 */
import http from 'node:http';

const SERVER = 'http://localhost:3000';
const BOT_ID = 'Claude';
const BOT_PASS = '1234';
const TARGET_ROOM = process.argv[2] || null;

interface Room {
  id: string;
  name?: string | null;
  member_count?: number;
}

interface LoginResponse {
  token?: string;
  user?: { id: string; display_name: string };
}

interface RoomsResponse {
  rooms?: Room[];
}

interface PushResult {
  message?: { id?: string };
  error?: string;
}

interface MessagesResponse {
  messages?: Array<{ sender_display_name: string; content?: string | null }>;
}

let token: string | null = null;

function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers: Record<string, string | number> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const url = new URL(path, SERVER);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d) as T); } catch { resolve({} as T); } }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main(): Promise<void> {
  console.log('🤖 Bot API テスト\n');

  // Login
  const login = await apiCall<LoginResponse>('POST', '/api/auth/login', { login_id: BOT_ID, password: BOT_PASS });
  if (!login.token || !login.user) {
    console.log('❌ ログイン失敗。BOT_IDとBOT_PASSを確認してください。');
    return;
  }
  token = login.token;
  console.log(`✅ ${login.user.display_name} でログイン\n`);

  // Get rooms
  const roomsData = await apiCall<RoomsResponse>('GET', '/api/bot/rooms');
  const rooms = roomsData.rooms || [];
  if (rooms.length === 0) {
    console.log('⚠ 参加中のルームがありません。');
    return;
  }

  console.log('📌 参加中のルーム:');
  rooms.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.name || 'DM'} (${r.member_count}人) [${r.id}]`);
  });
  console.log('');

  // Select room
  let targetRoom: Room | undefined;
  if (TARGET_ROOM) {
    // Match by number, name, or partial ID
    const num = parseInt(TARGET_ROOM);
    if (num >= 1 && num <= rooms.length) {
      targetRoom = rooms[num - 1];
    } else {
      targetRoom = rooms.find(r =>
        r.name === TARGET_ROOM || r.id === TARGET_ROOM || r.id.startsWith(TARGET_ROOM)
      );
    }
    if (!targetRoom) {
      console.log(`❌ ルーム「${TARGET_ROOM}」が見つかりません。番号(1〜${rooms.length})で指定してください。`);
      return;
    }
  } else {
    console.log('💡 使い方: node scripts/bot-api-test.ts <番号>');
    console.log('   例: node scripts/bot-api-test.ts 1');
    console.log('   例: node scripts/bot-api-test.ts "Web部"');
    console.log('');
    console.log('   ルーム名を指定せず全ルームにテスト送信します...\n');

    for (const room of rooms) {
      const name = room.name || 'DM';
      console.log(`📨 「${name}」に送信中...`);
      const result = await apiCall<PushResult>('POST', '/api/bot/push', {
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
  await apiCall<PushResult>('POST', '/api/bot/push', {
    room_id: targetRoom.id,
    content: `🤖 Bot APIテスト: ${new Date().toLocaleTimeString('ja-JP')} に送信しました。リアルタイムで届いていますか？`,
  });
  console.log(`   ✅ 送信成功\n`);

  // Get recent messages
  const since = new Date(Date.now() - 60000).toISOString();
  console.log('📥 直近メッセージ取得...');
  const msgs = await apiCall<MessagesResponse>('GET', `/api/bot/messages?room_id=${targetRoom.id}&since=${since}`);
  msgs.messages?.forEach(m => {
    console.log(`   💬 ${m.sender_display_name}: ${m.content || '(メディア)'}`);
  });

  console.log('\n🎉 テスト完了！');
}

main().catch(console.error);
