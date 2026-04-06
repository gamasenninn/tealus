#!/usr/bin/env node
/**
 * Tealus CLI — コマンドラインからTealusにメッセージを送信
 *
 * Usage:
 *   node scripts/tealus-cli.js send "Web部" --text "メッセージ"
 *   node scripts/tealus-cli.js send @田中太郎 --text "メッセージ"
 *   node scripts/tealus-cli.js send "Web部" --image ./screenshot.png
 *   node scripts/tealus-cli.js send "Web部" --voice ./recording.mp4
 *   node scripts/tealus-cli.js rooms
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Load .env from scripts directory
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...vals] = line.trim().split('=');
    if (key && !key.startsWith('#')) process.env[key] = vals.join('=');
  });
}

const SERVER = process.env.TEALUS_SERVER || 'http://localhost:3000';
const BOT_ID = process.env.TEALUS_BOT_ID;
const BOT_PASS = process.env.TEALUS_BOT_PASS;

if (!BOT_ID || !BOT_PASS) {
  console.error('❌ scripts/.env に TEALUS_BOT_ID と TEALUS_BOT_PASS を設定してください');
  process.exit(1);
}

// --- HTTP helpers ---

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(urlPath, SERVER);
    const proto = url.protocol === 'https:' ? https : http;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = proto.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadFile(token, endpoint, fieldName, filePath) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SERVER);
    const proto = url.protocol === 'https:' ? https : http;
    const boundary = '----TealusCLI' + Date.now();
    const fileName = path.basename(filePath);
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
      '.pdf': 'application/pdf', '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const req = proto.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Auth ---

async function login() {
  const data = await request('POST', '/api/auth/login', { employee_id: BOT_ID, password: BOT_PASS });
  if (!data.token) {
    console.error('❌ ログイン失敗:', data.error || 'Unknown error');
    process.exit(1);
  }
  return data.token;
}

// --- Room resolution ---

async function resolveRoom(token, target) {
  if (target.startsWith('@')) {
    // Direct message to user
    const userName = target.slice(1);
    const users = await request('GET', '/api/users', null, token);
    const user = users.users?.find(u => u.display_name === userName);
    if (!user) {
      console.error(`❌ ユーザー「${userName}」が見つかりません`);
      process.exit(1);
    }
    // Create or get direct room
    const room = await request('POST', '/api/rooms/direct', { partner_id: user.id }, token);
    return { id: room.room.id, name: userName };
  } else {
    // Group room by name
    const rooms = await request('GET', '/api/bot/rooms', null, token);
    const room = rooms.rooms?.find(r => r.name === target);
    if (!room) {
      console.error(`❌ ルーム「${target}」が見つかりません`);
      console.error('   参加中のルーム:');
      rooms.rooms?.forEach(r => console.error(`   - ${r.name || 'DM'}`));
      process.exit(1);
    }
    return { id: room.id, name: room.name };
  }
}

// --- Commands ---

async function cmdSend(args) {
  const target = args[0];
  if (!target) {
    console.error('❌ 送信先を指定してください');
    console.error('   例: node scripts/tealus-cli.js send "Web部" --text "メッセージ"');
    process.exit(1);
  }

  const textIdx = args.indexOf('--text');
  const imageIdx = args.indexOf('--image');
  const voiceIdx = args.indexOf('--voice');

  if (textIdx === -1 && imageIdx === -1 && voiceIdx === -1) {
    console.error('❌ --text, --image, --voice のいずれかを指定してください');
    process.exit(1);
  }

  const token = await login();
  const room = await resolveRoom(token, target);

  if (textIdx !== -1) {
    const text = args[textIdx + 1];
    if (!text) { console.error('❌ --text の後にメッセージを指定してください'); process.exit(1); }
    const result = await request('POST', '/api/bot/push', { room_id: room.id, content: text }, token);
    if (result.message) {
      console.log(`✅ テキスト送信: ${room.name} ← "${text}"`);
    } else {
      console.error('❌ 送信失敗:', result.error);
    }
  }

  if (imageIdx !== -1) {
    const filePath = args[imageIdx + 1];
    if (!filePath || !fs.existsSync(filePath)) { console.error('❌ 画像ファイルが見つかりません:', filePath); process.exit(1); }
    const result = await uploadFile(token, `/api/rooms/${room.id}/media`, 'files', filePath);
    if (result.message) {
      console.log(`✅ 画像送信: ${room.name} ← ${path.basename(filePath)}`);
    } else {
      console.error('❌ 送信失敗:', result.error);
    }
  }

  if (voiceIdx !== -1) {
    const filePath = args[voiceIdx + 1];
    if (!filePath || !fs.existsSync(filePath)) { console.error('❌ 音声ファイルが見つかりません:', filePath); process.exit(1); }
    const result = await uploadFile(token, `/api/rooms/${room.id}/voice`, 'voice', filePath);
    if (result.message) {
      console.log(`✅ 音声送信: ${room.name} ← ${path.basename(filePath)}（文字起こし自動実行）`);
    } else {
      console.error('❌ 送信失敗:', result.error);
    }
  }
}

async function cmdCheck(args) {
  const filteredArgs = args.filter(a => a !== '--json' && a !== '--mark-read');
  const target = filteredArgs[0];
  const jsonMode = args.includes('--json');
  const markRead = args.includes('--mark-read');
  const token = await login();

  let url = '/api/bot/unread';
  let roomName = '全ルーム';

  if (target) {
    const room = await resolveRoom(token, target);
    url += '?room_id=' + room.id;
    roomName = room.name;
  }

  const data = await request('GET', url, null, token);
  const messages = data.messages || [];

  if (jsonMode) {
    console.log(JSON.stringify(messages, null, 2));
  } else if (messages.length === 0) {
    console.log(`📭 未読メッセージはありません（${roomName}）`);
  } else {
    console.log(`📨 未読メッセージ（${roomName}）: ${messages.length}件`);
    messages.forEach(m => {
      const room = m.room_name || 'DM';
      const ago = Math.round((Date.now() - new Date(m.created_at).getTime()) / 60000);
      const timeStr = ago < 60 ? `${ago}分前` : `${Math.round(ago / 60)}時間前`;
      const content = m.content || '(メディア)';
      const preview = content.length > 40 ? content.slice(0, 40) + '...' : content;
      console.log(`  ${room} — ${m.sender_display_name}: ${preview} (${timeStr})`);
    });
  }

  // Mark as read
  if (markRead && messages.length > 0) {
    const ids = messages.map(m => m.id);
    const result = await request('POST', '/api/bot/mark-read', { message_ids: ids }, token);
    if (result.success) {
      console.log(`✅ ${result.count}件を既読にしました`);
    } else {
      console.error('❌ 既読処理に失敗:', result.error);
    }
  }
}

async function cmdRooms() {
  const token = await login();
  const rooms = await request('GET', '/api/bot/rooms', null, token);
  console.log('📌 参加中のルーム:');
  rooms.rooms?.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.name || 'DM'} (${r.member_count}人)`);
  });
}

// --- Main ---

const [,, command, ...args] = process.argv;

switch (command) {
  case 'send':
    cmdSend(args).catch(err => { console.error('❌ エラー:', err.message); process.exit(1); });
    break;
  case 'check':
    cmdCheck(args).catch(err => { console.error('❌ エラー:', err.message); process.exit(1); });
    break;
  case 'rooms':
    cmdRooms().catch(err => { console.error('❌ エラー:', err.message); process.exit(1); });
    break;
  default:
    console.log('Tealus CLI — コマンドラインからTealusにメッセージ送信');
    console.log('');
    console.log('使い方:');
    console.log('  node scripts/tealus-cli.js send "Web部" --text "メッセージ"');
    console.log('  node scripts/tealus-cli.js send @田中太郎 --text "メッセージ"');
    console.log('  node scripts/tealus-cli.js send "Web部" --image ./screenshot.png');
    console.log('  node scripts/tealus-cli.js send "Web部" --voice ./recording.mp4');
    console.log('  node scripts/tealus-cli.js check');
    console.log('  node scripts/tealus-cli.js check "Web部"');
    console.log('  node scripts/tealus-cli.js check --mark-read');
    console.log('  node scripts/tealus-cli.js check --json');
    console.log('  node scripts/tealus-cli.js rooms');
    console.log('');
    console.log('設定: scripts/.env に TEALUS_BOT_ID, TEALUS_BOT_PASS, TEALUS_SERVER を設定');
    break;
}
