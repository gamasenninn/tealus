#!/usr/bin/env node
/**
 * E2E harness の Tealus 側 setup を 1 操作で完了する script (#262)
 *
 * 動作:
 *   1. admin login → token 取得
 *   2. e2e-runner bot user 作成 (既存なら skip)
 *   3. アシスタント user UUID を解決
 *   4. e2e-sandbox group room 作成 (e2e-runner + アシスタント を member に)
 *   5. agent-server/.env に TEALUS_E2E_* env を追記 / 更新
 *
 * Usage (admin credential は env 経由で渡す、chat / argv に出さない):
 *   TEALUS_ADMIN_LOGIN_ID=xxx TEALUS_ADMIN_PASS=yyy node agent-server/tools/e2e/setup.js
 *
 * 出力:
 *   - .env に追加された env の verify 内容
 *   - test room UUID (room settings で TTS disable する案内)
 *   - 作成 / 既存の判定
 *
 * 注意:
 *   - admin credential は env 経由のみ受け付ける (chat 露出回避)
 *   - 既に存在する user / room を再利用 (idempotent な動作)
 *   - .env への書込みは marker 行で囲む (安全な再実行)
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const TEALUS_API_URL = process.env.TEALUS_API_URL || 'http://localhost:3000';
const ADMIN_ID = process.env.TEALUS_ADMIN_LOGIN_ID;
const ADMIN_PASS = process.env.TEALUS_ADMIN_PASS;
const ASSISTANT_ID = process.env.TEALUS_BOT_ID || 'AI_AGENT';
const ENV_PATH = path.join(__dirname, '../../.env');

if (!ADMIN_ID || !ADMIN_PASS) {
  console.error('[setup] TEALUS_ADMIN_LOGIN_ID / TEALUS_ADMIN_PASS を env で渡してください');
  process.exit(1);
}

const log = (m) => console.log(`[setup] ${m}`);

async function adminLogin() {
  const res = await fetch(`${TEALUS_API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id: ADMIN_ID, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`admin login failed: ${data.error || 'unknown'}`);
  if (data.user.role !== 'admin') throw new Error(`user ${ADMIN_ID} is not admin (role=${data.user.role})`);
  log(`admin logged in as ${data.user.display_name} (${data.user.id})`);
  return data.token;
}

async function listUsers(token) {
  const res = await fetch(`${TEALUS_API_URL}/api/admin/users`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return data.users || [];
}

async function createBotUser(token, login_id, display_name, password) {
  const res = await fetch(`${TEALUS_API_URL}/api/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      login_id,
      display_name,
      password,
      role: 'user',
      is_bot: true,
    }),
  });
  const data = await res.json();
  if (!data.user) throw new Error(`create bot failed: ${JSON.stringify(data)}`);
  return data.user;
}

async function createRoom(token, name, member_ids) {
  // First login as e2e-runner to use POST /api/rooms (user-level endpoint)
  // Actually admin can create rooms via /api/rooms too. Let's try user-level.
  const res = await fetch(`${TEALUS_API_URL}/api/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ name, member_ids }),
  });
  const data = await res.json();
  if (!data.room) throw new Error(`create room failed: ${JSON.stringify(data)}`);
  return data.room;
}

async function listMyRooms(token) {
  const res = await fetch(`${TEALUS_API_URL}/api/rooms`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return data.rooms || [];
}

function generatePassword() {
  return 'e2e-' + crypto.randomBytes(12).toString('hex');
}

function updateEnvFile(updates) {
  const MARKER_BEGIN = '# >>> E2E harness setup (#262、tools/e2e/setup.js が管理)';
  const MARKER_END = '# <<< E2E harness setup';

  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  // remove existing block
  const beginIdx = content.indexOf(MARKER_BEGIN);
  const endIdx = content.indexOf(MARKER_END);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = content.slice(0, beginIdx).trimEnd();
    const after = content.slice(endIdx + MARKER_END.length).trimStart();
    content = before + (before ? '\n' : '') + after;
  }
  // append new block
  const lines = [MARKER_BEGIN];
  for (const [k, v] of Object.entries(updates)) lines.push(`${k}=${v}`);
  lines.push(MARKER_END);
  if (!content.endsWith('\n')) content += '\n';
  content += '\n' + lines.join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

async function main() {
  const token = await adminLogin();
  const users = await listUsers(token);

  // resolve アシスタント (AI_AGENT) user
  const assistant = users.find(u => u.login_id === ASSISTANT_ID);
  if (!assistant) throw new Error(`assistant user not found (login_id=${ASSISTANT_ID})`);
  log(`assistant: ${assistant.display_name} (${assistant.id})`);

  // resolve / create e2e-runner
  let e2eRunner = users.find(u => u.login_id === 'e2e-runner');
  let e2ePassword;
  if (!e2eRunner) {
    e2ePassword = generatePassword();
    e2eRunner = await createBotUser(token, 'e2e-runner', 'E2E Test Runner', e2ePassword);
    log(`created e2e-runner bot user (${e2eRunner.id})`);
  } else {
    log(`e2e-runner already exists (${e2eRunner.id})`);
    log(`  → password 不明。reset したい場合は admin UI から手動で reset してください`);
    // 既存 password を取得する方法はない (security)
    // .env に既に保存されているか確認
    e2ePassword = process.env.TEALUS_E2E_BOT_PASS;
    if (!e2ePassword) {
      log(`  ⚠️  TEALUS_E2E_BOT_PASS が .env にないので run できない可能性`);
      log(`  → 解決策: admin UI で e2e-runner の password を reset してから .env に手動で記入`);
      log(`  または: e2e-runner を一旦削除 (admin UI) してから setup を再実行`);
    }
  }

  // resolve / create e2e-sandbox room
  // login as e2e-runner to find / create the room (user-level API、creator が admin になる)
  let e2eToken = token;
  if (e2ePassword) {
    const r = await fetch(`${TEALUS_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: 'e2e-runner', password: e2ePassword }),
    });
    const d = await r.json();
    if (d.token) {
      e2eToken = d.token;
      log(`e2e-runner login OK`);
    } else {
      log(`e2e-runner login failed (existing user with unknown password?)`);
    }
  }

  const myRooms = await listMyRooms(e2eToken);
  let sandbox = myRooms.find(r => r.name === 'e2e-sandbox');
  if (!sandbox) {
    sandbox = await createRoom(e2eToken, 'e2e-sandbox', [e2eRunner.id, assistant.id]);
    log(`created e2e-sandbox room (${sandbox.id})`);
  } else {
    log(`e2e-sandbox already exists (${sandbox.id})`);
  }

  // update .env
  if (e2ePassword) {
    updateEnvFile({
      TEALUS_E2E_BOT_ID: 'e2e-runner',
      TEALUS_E2E_BOT_PASS: e2ePassword,
      TEALUS_E2E_ROOM_ID: sandbox.id,
    });
    log(`.env updated with E2E env (marker block)`);
  } else {
    log(`.env update skipped (password 不明、手動で記入してください)`);
  }

  log(``);
  log(`=== Setup summary ===`);
  log(`e2e-runner user: ${e2eRunner.id}`);
  log(`e2e-sandbox room: ${sandbox.id}`);
  log(`Assistant bot: ${assistant.id}`);
  log(``);
  log(`次の手動 step:`);
  log(`  1. e2e-sandbox room の TTS を disable (Aivis 課金回避、room settings or admin UI)`);
  log(`  2. agent-server を再起動 (新 .env を反映)`);
  log(`  3. node agent-server/tools/e2e/run.js --filter S5 で smoke test`);
  log(`     (S5 = greeting、tool call なし最軽量)`);
}

main().catch(err => {
  console.error(`[setup] ${err.stack || err.message}`);
  process.exit(2);
});
