const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

/**
 * POST /api/bot/messages/:id/transcribe の integration tests。
 *
 * cached path / error path / type 検証 を中心に test。
 * 実 transcribe 経路 (OpenAI Whisper call) は既存 voice.test.js でカバー済、
 * 本 test では「endpoint layer の logic」(auth、type check、cache return、404/400/403) を verify。
 */
describe('POST /api/bot/messages/:id/transcribe', () => {
  let bot, user1, roomId;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    bot = await createTestUser({ login_id: 'BOT001', display_name: 'Tealus Bot' });
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });

    const pool = getTestPool();
    await pool.query("UPDATE users SET is_bot = true WHERE id = $1", [bot.user.id]);

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [bot.user.id] });
    roomId = roomRes.body.room.id;
  });

  it('既存の voice transcription があれば cached: true で返す', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
      [roomId, user1.user.id]
    );
    const messageId = msgRes.rows[0].id;
    await pool.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, 'voices/dummy.webm', 'dummy.webm', 'audio/webm', 1024)`,
      [messageId]
    );
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
       VALUES ($1, 'こんにちは', 'こんにちは。', 'done', 1)`,
      [messageId]
    );

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.status).toBe('done');
    expect(res.body.message_type).toBe('voice');
    expect(res.body.formatted_text).toBe('こんにちは。');
    expect(res.body.raw_text).toBe('こんにちは');
    expect(res.body.language).toBe('ja');
    expect(res.body.version).toBe(1);
    expect(res.body.model).toBeDefined();
  });

  it('複数 version あれば最新 version の done row を返す', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
      [roomId, user1.user.id]
    );
    const messageId = msgRes.rows[0].id;
    await pool.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, 'voices/dummy.webm', 'dummy.webm', 'audio/webm', 1024)`,
      [messageId]
    );
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
       VALUES ($1, 'v1 raw', 'v1 formatted', 'done', 1),
              ($1, 'v2 raw', 'v2 formatted (latest)', 'done', 2)`,
      [messageId]
    );

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.version).toBe(2);
    expect(res.body.formatted_text).toBe('v2 formatted (latest)');
  });

  it('text type メッセージは 400 でエラー', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'テキスト') RETURNING id`,
      [roomId, user1.user.id]
    );
    const messageId = msgRes.rows[0].id;

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/サポート対象外/);
    expect(res.body.message_type).toBe('text');
  });

  it('image type メッセージは 400 でエラー', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'image', NULL) RETURNING id`,
      [roomId, user1.user.id]
    );
    const messageId = msgRes.rows[0].id;

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(400);
    expect(res.body.message_type).toBe('image');
  });

  it('存在しない message_id は 404', async () => {
    const res = await request(app)
      .post('/api/bot/messages/00000000-0000-0000-0000-000000000000/transcribe')
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(404);
  });

  it('削除済 (is_deleted=true) は 410', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type, is_deleted) VALUES ($1, $2, 'voice', true) RETURNING id`,
      [roomId, user1.user.id]
    );
    const res = await request(app)
      .post(`/api/bot/messages/${msgRes.rows[0].id}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(410);
  });

  it('media なし voice メッセージは 404', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
      [roomId, user1.user.id]
    );

    const res = await request(app)
      .post(`/api/bot/messages/${msgRes.rows[0].id}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/メディアはありません/);
  });

  it('非メンバー Bot は 403', async () => {
    // 別 user の room を作成、bot は参加していない
    const user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    const room2Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ name: '別ルーム', member_ids: [] });

    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
      [room2Res.body.room.id, user2.user.id]
    );
    const messageId = msgRes.rows[0].id;
    await pool.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, 'voices/dummy.webm', 'dummy.webm', 'audio/webm', 1024)`,
      [messageId]
    );

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(403);
  });

  it('Authorization なしは 401', async () => {
    const res = await request(app)
      .post('/api/bot/messages/aaa/transcribe');

    expect(res.status).toBe(401);
  });

  it('video type で cached あれば cached: true で返す (回帰: video も同 endpoint で扱える)', async () => {
    const pool = getTestPool();
    const msgRes = await pool.query(
      `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'video') RETURNING id`,
      [roomId, user1.user.id]
    );
    const messageId = msgRes.rows[0].id;
    await pool.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, 'videos/dummy.mp4', 'dummy.mp4', 'video/mp4', 10000000)`,
      [messageId]
    );
    await pool.query(
      `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
       VALUES ($1, '動画の音声テキスト', '動画の音声テキストです。', 'done', 1)`,
      [messageId]
    );

    const res = await request(app)
      .post(`/api/bot/messages/${messageId}/transcribe`)
      .set('Authorization', `Bearer ${bot.token}`);

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.message_type).toBe('video');
    expect(res.body.formatted_text).toBe('動画の音声テキストです。');
  });
});
