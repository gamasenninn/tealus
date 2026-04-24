/**
 * Demo データ seed スクリプト
 *
 * OSS 公開時の README スクリーンショットおよび
 * 採用者が「触ってみる」ためのデモデータを投入する。
 *
 * 既存データを ALL DELETE したうえで投入するため、
 * **本番・開発環境では絶対に実行しないこと**。
 *
 * 使い方:
 *   cd server
 *   node scripts/seed-demo.js --confirm
 *
 * 接続先は .env もしくは環境変数から読む（通常の server と同じ）。
 * デモ用に別 DB を立てる場合は DB_NAME 等を上書きして実行する:
 *   DB_NAME=tealus_demo node scripts/seed-demo.js --confirm
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const CONFIRM = process.argv.includes('--confirm');

if (!CONFIRM) {
  console.error('[seed-demo] このスクリプトは既存データを全削除します。');
  console.error('[seed-demo] 実行するには --confirm フラグを付けてください:');
  console.error('[seed-demo]   node scripts/seed-demo.js --confirm');
  process.exit(1);
}

const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, '../../media');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'tealus',
  user: process.env.DB_USER || 'tealus',
  password: process.env.DB_PASSWORD || 'tealus_dev',
});

const USERS = [
  { login_id: 'admin',     display_name: '管理者',             role: 'admin', is_bot: false, status: 'システム管理者' },
  { login_id: 'alice',     display_name: 'Alice Smith',        role: 'user',  is_bot: false, status: 'プロダクト企画' },
  { login_id: 'bob',       display_name: 'Bob Tanaka',         role: 'user',  is_bot: false, status: 'バックエンド開発' },
  { login_id: 'charlie',   display_name: 'Charlie Johnson',    role: 'user',  is_bot: false, status: 'デザイナー' },
  { login_id: 'assistant', display_name: 'AI アシスタント',    role: 'user',  is_bot: true,  status: 'お困りごとはお気軽に' },
];

const DEMO_PASSWORD = 'demo1234';

async function wipe(client) {
  // 設計上メッセージ・ルーム・ユーザーがほぼ全ての FK の起点なので
  // これだけ TRUNCATE CASCADE すれば周辺テーブルも飛ぶ
  await client.query(`
    TRUNCATE TABLE
      message_reactions, message_reads, link_previews,
      voice_transcriptions, message_media, message_tags,
      tags, messages,
      room_read_cursors, room_members, rooms,
      push_subscriptions, user_stamp_usage, agent_contexts,
      users
    CASCADE
  `);
  console.log('[seed-demo] 既存データをクリアしました');
}

async function seedUsers(client) {
  const userMap = {};
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of USERS) {
    const res = await client.query(
      `INSERT INTO users (login_id, display_name, password_hash, role, is_bot, status_message, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, login_id`,
      [u.login_id, u.display_name, hash, u.role, u.is_bot, u.status],
    );
    userMap[u.login_id] = res.rows[0].id;
  }
  console.log(`[seed-demo] ユーザー ${USERS.length} 人を作成しました（全員パスワードは "${DEMO_PASSWORD}"）`);
  return userMap;
}

async function generateDemoImage() {
  const imagesDir = path.join(MEDIA_ROOT, 'images');
  const thumbsDir = path.join(MEDIA_ROOT, 'thumbnails');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });

  const filename = `demo-${Date.now()}.png`;
  const imagePath = path.join(imagesDir, filename);
  const thumbPath = path.join(thumbsDir, filename);

  const svg = Buffer.from(`
    <svg width="800" height="450" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#14b8a6"/>
          <stop offset="100%" stop-color="#0891b2"/>
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#g)"/>
      <text x="400" y="210" text-anchor="middle" font-family="sans-serif" font-size="48" fill="white">
        Demo Screenshot
      </text>
      <text x="400" y="270" text-anchor="middle" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,0.85)">
        Tealus — Open Source Messenger
      </text>
    </svg>
  `);

  await sharp(svg).png().toFile(imagePath);
  await sharp(svg).resize(400, 225).png().toFile(thumbPath);

  return {
    file_path: `images/${filename}`,
    thumbnail_path: `thumbnails/${filename}`,
  };
}

async function seedRoomsAndMessages(client, users) {
  // --- DM: alice ↔ assistant ---
  const dm = await client.query(
    `INSERT INTO rooms (type, created_by) VALUES ('direct', $1) RETURNING id`,
    [users.alice],
  );
  const dmId = dm.rows[0].id;

  await client.query(
    `INSERT INTO room_members (room_id, user_id, is_group_admin) VALUES ($1, $2, false), ($1, $3, false)`,
    [dmId, users.alice, users.assistant],
  );

  await client.query(
    `INSERT INTO messages (room_id, sender_id, content, type, created_at)
     VALUES
       ($1, $2, '今日の予定を教えてください', 'text', now() - interval '5 minutes'),
       ($1, $3, '本日は 10:00 から週次ミーティング、14:00 からプロダクトレビューが予定されています。その他に急ぎのタスクはありません。', 'text', now() - interval '4 minutes'),
       ($1, $2, 'ありがとうございます！', 'text', now() - interval '3 minutes')`,
    [dmId, users.alice, users.assistant],
  );

  // --- Group: プロジェクトAlpha ---
  const grp = await client.query(
    `INSERT INTO rooms (type, name, created_by) VALUES ('group', 'プロジェクト Alpha', $1) RETURNING id`,
    [users.alice],
  );
  const grpId = grp.rows[0].id;

  await client.query(
    `INSERT INTO room_members (room_id, user_id, is_group_admin) VALUES
       ($1, $2, true),
       ($1, $3, false),
       ($1, $4, false)`,
    [grpId, users.alice, users.bob, users.charlie],
  );

  // 画像付きメッセージ用のデモ画像を生成
  const demoImage = await generateDemoImage();

  // 1. alice: 挨拶
  const m1 = await client.query(
    `INSERT INTO messages (room_id, sender_id, content, type, created_at)
     VALUES ($1, $2, 'おはようございます。今日もよろしくお願いします！', 'text', now() - interval '2 hours')
     RETURNING id`,
    [grpId, users.alice],
  );

  // 2. bob: リプライ
  await client.query(
    `INSERT INTO messages (room_id, sender_id, content, type, reply_to, created_at)
     VALUES ($1, $2, 'おはようございます！仕様書のレビューを完了しました。', 'text', $3, now() - interval '1 hour 50 minutes')`,
    [grpId, users.bob, m1.rows[0].id],
  );

  // 3. charlie: 画像メッセージ
  const m3 = await client.query(
    `INSERT INTO messages (room_id, sender_id, type, created_at)
     VALUES ($1, $2, 'image', now() - interval '1 hour 30 minutes')
     RETURNING id`,
    [grpId, users.charlie],
  );
  await client.query(
    `INSERT INTO message_media (message_id, mime_type, file_path, thumbnail_path, original_name, sort_order)
     VALUES ($1, 'image/png', $2, $3, 'demo.png', 0)`,
    [m3.rows[0].id, demoImage.file_path, demoImage.thumbnail_path],
  );

  // 4. alice: charlie の画像にリアクション
  await client.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '👍')`,
    [m3.rows[0].id, users.alice],
  );
  await client.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '🎨')`,
    [m3.rows[0].id, users.bob],
  );

  // 5. alice: markdown 風のテキスト
  await client.query(
    `INSERT INTO messages (room_id, sender_id, content, type, created_at)
     VALUES ($1, $2, 'ToDo:
- [x] 仕様書レビュー
- [ ] API 実装
- [ ] テスト追加', 'text', now() - interval '1 hour')`,
    [grpId, users.alice],
  );

  // 6. bob: 最新の進捗
  await client.query(
    `INSERT INTO messages (room_id, sender_id, content, type, created_at)
     VALUES ($1, $2, 'API 実装を開始します。完了予定は明日の午前中です。', 'text', now() - interval '30 minutes')`,
    [grpId, users.bob],
  );

  console.log('[seed-demo] ルーム 2 件（DM + グループ）とメッセージ・リアクションを作成しました');
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await wipe(client);
    const users = await seedUsers(client);
    await seedRoomsAndMessages(client, users);
    await client.query('COMMIT');
    console.log('');
    console.log('[seed-demo] 完了');
    console.log('[seed-demo] ログイン情報:');
    console.log(`[seed-demo]   ユーザーID:  admin / alice / bob / charlie / assistant`);
    console.log(`[seed-demo]   パスワード:  ${DEMO_PASSWORD}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed-demo] エラー:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
