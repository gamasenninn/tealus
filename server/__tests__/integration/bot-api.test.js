const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');
const { MEDIA_ROOT } = require('../../src/middleware/upload');

describe('Bot API', () => {
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

    // Mark as bot
    const pool = getTestPool();
    await pool.query("UPDATE users SET is_bot = true WHERE id = $1", [bot.user.id]);

    // Create room with bot and user
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [bot.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/bot/push
  // ============================================
  describe('POST /api/bot/push', () => {
    it('should send a message with Socket.IO broadcast', async () => {
      const res = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, content: 'Botからのメッセージ' });

      expect(res.status).toBe(201);
      expect(res.body.message.content).toBe('Botからのメッセージ');
      expect(res.body.message.sender_id).toBe(bot.user.id);
    });

    it('should reject without room_id', async () => {
      const res = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ content: 'テスト' });

      expect(res.status).toBe(400);
    });

    it('should reject without content', async () => {
      const res = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId });

      expect(res.status).toBe(400);
    });

    it('should reject non-member', async () => {
      const user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
      const room2Res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: '別のルーム', member_ids: [] });

      const res = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: room2Res.body.room.id, content: 'テスト' });

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/bot/push')
        .send({ room_id: roomId, content: 'テスト' });

      expect(res.status).toBe(401);
    });

    it('should appear in message history', async () => {
      await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, content: 'Bot投稿テスト' });

      const msgs = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(msgs.body.messages.length).toBe(1);
      expect(msgs.body.messages[0].content).toBe('Bot投稿テスト');
    });
  });

  // ============================================
  // POST /api/bot/tts-speak（#184 browser TTS provider）
  // ============================================
  describe('POST /api/bot/tts-speak', () => {
    it('should accept tts speak request from a room member', async () => {
      const res = await request(app)
        .post('/api/bot/tts-speak')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ room_id: roomId, text: 'こんにちは' });

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
    });

    it('should reject if not a room member', async () => {
      const outsider = await createTestUser({ login_id: 'EMPTTS01', display_name: 'よそ者' });
      const res = await request(app)
        .post('/api/bot/tts-speak')
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ room_id: roomId, text: 'こんにちは' });

      expect(res.status).toBe(403);
    });

    it('should require room_id and text', async () => {
      const noRoom = await request(app)
        .post('/api/bot/tts-speak')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: 'hi' });
      expect(noRoom.status).toBe(400);

      const noText = await request(app)
        .post('/api/bot/tts-speak')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ room_id: roomId });
      expect(noText.status).toBe(400);
    });
  });

  // ============================================
  // POST /api/bot/tts-audio + GET /:id (#189 aivis-cloud Socket.IO 配信)
  // ============================================
  describe('POST /api/bot/tts-audio + GET /:id', () => {
    const fakeWav = Buffer.from('RIFFXXXXWAVEfake-pcm-data');

    it('should accept WAV upload from a room member and return id+url', async () => {
      const res = await request(app)
        .post('/api/bot/tts-audio')
        .set('Authorization', `Bearer ${user1.token}`)
        .field('room_id', roomId)
        .attach('audio', fakeWav, { filename: 'tts.wav', contentType: 'audio/wav' });

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.id).toMatch(/^[a-f0-9]{32}$/);
      expect(res.body.url).toBe(`/api/bot/tts-audio/${res.body.id}`);
    });

    it('should serve the cached WAV via GET', async () => {
      const post = await request(app)
        .post('/api/bot/tts-audio')
        .set('Authorization', `Bearer ${user1.token}`)
        .field('room_id', roomId)
        .attach('audio', fakeWav, { filename: 'tts.wav', contentType: 'audio/wav' });

      const get = await request(app)
        .get(post.body.url)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(get.status).toBe(200);
      expect(get.headers['content-type']).toMatch(/^audio\/wav/);
      expect(get.body).toEqual(fakeWav);
    });

    it('should return 404 for unknown id', async () => {
      const res = await request(app)
        .get('/api/bot/tts-audio/0000000000000000000000000000000a')
        .set('Authorization', `Bearer ${user1.token}`);
      expect(res.status).toBe(404);
    });

    it('should reject if not a room member', async () => {
      const outsider = await createTestUser({ login_id: 'EMPTTS02', display_name: 'よそ者2' });
      const res = await request(app)
        .post('/api/bot/tts-audio')
        .set('Authorization', `Bearer ${outsider.token}`)
        .field('room_id', roomId)
        .attach('audio', fakeWav, { filename: 'tts.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(403);
    });

    it('should require room_id', async () => {
      const res = await request(app)
        .post('/api/bot/tts-audio')
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('audio', fakeWav, { filename: 'tts.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(400);
    });

    it('should require audio file', async () => {
      const res = await request(app)
        .post('/api/bot/tts-audio')
        .set('Authorization', `Bearer ${user1.token}`)
        .field('room_id', roomId);
      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/bot/messages
  // ============================================
  describe('GET /api/bot/messages', () => {
    it('should return messages since timestamp', async () => {
      const since = new Date().toISOString();

      // Wait a bit then send
      await new Promise(r => setTimeout(r, 100));
      await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '新着メッセージ' });

      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}&since=${since}`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages.length).toBe(1);
      expect(res.body.messages[0].content).toBe('新着メッセージ');
    });

    it('should reject without room_id', async () => {
      const res = await request(app)
        .get('/api/bot/messages?since=2026-01-01')
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/bot/messages — reactions (#324)
  // ============================================
  describe('GET /api/bot/messages — reactions (#324)', () => {
    it('各メッセージに reactions 集約を付与（無リアクションは空配列）', async () => {
      const pool = getTestPool();
      const r1 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '完了したやつ') RETURNING id`,
        [roomId, user1.user.id]
      );
      const reactedId = r1.rows[0].id;
      const r2 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '未処理のやつ') RETURNING id`,
        [roomId, user1.user.id]
      );
      const plainId = r2.rows[0].id;
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '✅')`,
        [reactedId, user1.user.id]
      );

      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.messages.map(m => [m.id, m]));
      expect(byId[reactedId].reactions).toEqual([{ emoji: '✅', count: 1 }]);
      expect(byId[plainId].reactions).toEqual([]);
    });

    it('同一 emoji の複数リアクションは count に集約される', async () => {
      const pool = getTestPool();
      const user2 = await createTestUser({ login_id: 'EMP002', display_name: '佐藤花子' });
      const r = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '人気') RETURNING id`,
        [roomId, user1.user.id]
      );
      const id = r.rows[0].id;
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '👍'), ($1, $3, '👍')`,
        [id, user1.user.id, user2.user.id]
      );

      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);

      const msg = res.body.messages.find(m => m.id === id);
      expect(msg.reactions).toEqual([{ emoji: '👍', count: 2 }]);
    });
  });

  // ============================================
  // GET /api/bot/messages — transcription verbosity (#219)
  // ============================================
  describe('GET /api/bot/messages — transcription verbosity (#219)', () => {
    let voiceMsgId, voiceMultiVersionMsgId, voiceNoTransMsgId, textMsgId;

    beforeEach(async () => {
      const pool = getTestPool();

      // text message
      const r1 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'テキスト本文') RETURNING id`,
        [roomId, user1.user.id]
      );
      textMsgId = r1.rows[0].id;

      // voice message with transcription v1
      const r2 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      voiceMsgId = r2.rows[0].id;
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
         VALUES ($1, '生のおと', '整形済みテキストです。', 'done', 1)`,
        [voiceMsgId]
      );

      // voice message with multiple versions (v1 + v2)
      const r3 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      voiceMultiVersionMsgId = r3.rows[0].id;
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
         VALUES ($1, 'v1 生', 'v1 整形', 'done', 1),
                ($1, 'v2 生', 'v2 整形 (latest)', 'done', 2)`,
        [voiceMultiVersionMsgId]
      );

      // voice message with no transcription row
      const r4 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      voiceNoTransMsgId = r4.rows[0].id;
    });

    it('default (flag 未指定): voice transcription は formatted_text のみ inline、raw_text は省略', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const voice = res.body.messages.find(m => m.id === voiceMsgId);
      expect(voice.transcription).toBeDefined();
      expect(voice.transcription.formatted_text).toBe('整形済みテキストです。');
      expect(voice.transcription.status).toBe('done');
      expect(voice.transcription.version).toBe(1);
      expect(voice.transcription.raw_text).toBeUndefined();
    });

    it('include_raw=true: raw_text と formatted_text の両方を inline で返す', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}&include_raw=true`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const voice = res.body.messages.find(m => m.id === voiceMsgId);
      expect(voice.transcription.formatted_text).toBe('整形済みテキストです。');
      expect(voice.transcription.raw_text).toBe('生のおと');
      expect(voice.transcription.status).toBe('done');
      expect(voice.transcription.version).toBe(1);
    });

    it('include_transcription=false: text field を省略し id + status + version のみ返す', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}&include_transcription=false`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const voice = res.body.messages.find(m => m.id === voiceMsgId);
      expect(voice.transcription).toBeDefined();
      expect(voice.transcription.id).toBeDefined();
      expect(voice.transcription.status).toBe('done');
      expect(voice.transcription.version).toBe(1);
      expect(voice.transcription.formatted_text).toBeUndefined();
      expect(voice.transcription.raw_text).toBeUndefined();
    });

    it('text message には verbosity flag に関わらず transcription field が付かない', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}&include_raw=true`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const text = res.body.messages.find(m => m.id === textMsgId);
      expect(text.transcription).toBeUndefined();
    });

    it('voice message に transcription row が無い場合は transcription field を付けない', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const voice = res.body.messages.find(m => m.id === voiceNoTransMsgId);
      expect(voice).toBeDefined();
      expect(voice.transcription).toBeUndefined();
    });

    it('複数 version の transcription は最新版 (version=2) を返す', async () => {
      const res = await request(app)
        .get(`/api/bot/messages?room_id=${roomId}&include_raw=true`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      const voice = res.body.messages.find(m => m.id === voiceMultiVersionMsgId);
      expect(voice.transcription.version).toBe(2);
      expect(voice.transcription.formatted_text).toBe('v2 整形 (latest)');
      expect(voice.transcription.raw_text).toBe('v2 生');
    });
  });

  // ============================================
  // GET /api/bot/messages/:id/media
  // ============================================
  describe('GET /api/bot/messages/:id/media', () => {
    const TEST_FIXTURE_DIR = 'test-fixtures-bot-media';
    const TEST_FIXTURE_PATH = path.join(MEDIA_ROOT, TEST_FIXTURE_DIR);

    beforeAll(() => {
      fs.mkdirSync(TEST_FIXTURE_PATH, { recursive: true });
    });

    afterAll(() => {
      try { fs.rmSync(TEST_FIXTURE_PATH, { recursive: true, force: true }); } catch {}
    });

    async function insertImageMessage(senderId, roomId, fileContent = 'PNG-TEST-DATA') {
      const pool = getTestPool();
      const filename = `test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
      const relPath = `${TEST_FIXTURE_DIR}/${filename}`;
      const fullPath = path.join(TEST_FIXTURE_PATH, filename);
      fs.writeFileSync(fullPath, fileContent);

      const msgRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'image', NULL) RETURNING id`,
        [roomId, senderId]
      );
      const messageId = msgRes.rows[0].id;
      await pool.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
         VALUES ($1, $2, $3, 'image/png', $4)`,
        [messageId, relPath, filename, fileContent.length]
      );
      return { messageId, fullPath, filename, relPath };
    }

    it('should return base64 image data for room member bot', async () => {
      const { messageId } = await insertImageMessage(user1.user.id, roomId);
      const res = await request(app)
        .get(`/api/bot/messages/${messageId}/media`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      expect(res.body.type).toBe('image');
      expect(res.body.mime_type).toBe('image/png');
      expect(res.body.data_base64).toBeTruthy();
      expect(Buffer.from(res.body.data_base64, 'base64').toString()).toBe('PNG-TEST-DATA');
      expect(res.body.file_size).toBe('PNG-TEST-DATA'.length);
    });

    it('should reject non-member bot', async () => {
      // Create another room without bot
      const user2 = await createTestUser({ login_id: 'EMP002', display_name: '別ユーザ' });
      const room2Res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: 'Bot 不在ルーム', member_ids: [] });
      const { messageId } = await insertImageMessage(user2.user.id, room2Res.body.room.id);

      const res = await request(app)
        .get(`/api/bot/messages/${messageId}/media`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(403);
    });

    it('should 404 for unknown message', async () => {
      const res = await request(app)
        .get('/api/bot/messages/00000000-0000-0000-0000-000000000000/media')
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(404);
    });

    it('should 404 for text message (no media)', async () => {
      const pool = getTestPool();
      const msg = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'no media') RETURNING id`,
        [roomId, user1.user.id]
      );
      const res = await request(app)
        .get(`/api/bot/messages/${msg.rows[0].id}/media`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(404);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .get('/api/bot/messages/00000000-0000-0000-0000-000000000000/media');
      expect(res.status).toBe(401);
    });

    // #316: 複数添付メッセージの index 取得
    async function insertMultiImageMessage(senderId, rid, contents) {
      const pool = getTestPool();
      const msgRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'image', NULL) RETURNING id`,
        [rid, senderId]
      );
      const messageId = msgRes.rows[0].id;
      const filenames = [];
      for (let i = 0; i < contents.length; i++) {
        const filename = `multi-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.png`;
        fs.writeFileSync(path.join(TEST_FIXTURE_PATH, filename), contents[i]);
        // 個別 query (autocommit) で created_at を分け、ORDER BY created_at が挿入順になる
        await pool.query(
          `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
           VALUES ($1, $2, $3, 'image/png', $4)`,
          [messageId, `${TEST_FIXTURE_DIR}/${filename}`, filename, contents[i].length]
        );
        filenames.push(filename);
      }
      return { messageId, filenames };
    }

    it('#316: returns media_count + media metadata array for multi-attachment', async () => {
      const { messageId } = await insertMultiImageMessage(user1.user.id, roomId, ['IMG-A', 'IMG-B', 'IMG-C']);
      const res = await request(app)
        .get(`/api/bot/messages/${messageId}/media`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.media_count).toBe(3);
      expect(Array.isArray(res.body.media)).toBe(true);
      expect(res.body.media).toHaveLength(3);
      expect(res.body.media[0]).toMatchObject({ index: 0, mime_type: 'image/png' });
      // 既定 (index 省略) は 1 枚目を返す = 後方互換
      expect(res.body.index).toBe(0);
      expect(Buffer.from(res.body.data_base64, 'base64').toString()).toBe('IMG-A');
    });

    it('#316: ?index=N returns the N-th media (stable order)', async () => {
      const { messageId } = await insertMultiImageMessage(user1.user.id, roomId, ['IMG-A', 'IMG-B', 'IMG-C']);
      const res1 = await request(app)
        .get(`/api/bot/messages/${messageId}/media?index=1`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res1.status).toBe(200);
      expect(res1.body.index).toBe(1);
      expect(Buffer.from(res1.body.data_base64, 'base64').toString()).toBe('IMG-B');
      const res2 = await request(app)
        .get(`/api/bot/messages/${messageId}/media?index=2`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(Buffer.from(res2.body.data_base64, 'base64').toString()).toBe('IMG-C');
    });

    it('#316: out-of-range index returns 400', async () => {
      const { messageId } = await insertMultiImageMessage(user1.user.id, roomId, ['IMG-A', 'IMG-B']);
      const res = await request(app)
        .get(`/api/bot/messages/${messageId}/media?index=5`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(400);
    });

    it('#316: single-media message still returns media_count=1 (backward compat)', async () => {
      const { messageId } = await insertImageMessage(user1.user.id, roomId);
      const res = await request(app)
        .get(`/api/bot/messages/${messageId}/media`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.media_count).toBe(1);
      expect(res.body.data_base64).toBeTruthy();
    });
  });

  // ============================================
  // GET /api/bot/search (#194)
  // ============================================
  describe('GET /api/bot/search', () => {
    let user2, otherRoomId;
    let textMsgId, imageMsgId, voiceMsgId, taggedMsgId;
    let oldMsgId;

    beforeEach(async () => {
      const pool = getTestPool();

      // 別ルーム (bot 不在) を準備
      user2 = await createTestUser({ login_id: 'EMP002', display_name: '別ユーザ' });
      const otherRoomRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: 'Bot 不在ルーム', member_ids: [] });
      otherRoomId = otherRoomRes.body.room.id;

      // 標準テストデータを bot 所属 room に投入
      const r1 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '削除確認の挙動を直す') RETURNING id`,
        [roomId, user1.user.id]
      );
      textMsgId = r1.rows[0].id;

      const r2 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'image', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      imageMsgId = r2.rows[0].id;

      const r3 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', NULL) RETURNING id`,
        [roomId, user1.user.id]
      );
      voiceMsgId = r3.rows[0].id;
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version)
         VALUES ($1, '音声メッセージのテストです', '音声メッセージのテストです。', 'done', 1)`,
        [voiceMsgId]
      );

      // タグ付きメッセージ
      const r4 = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '今週の TODO 候補') RETURNING id`,
        [roomId, user1.user.id]
      );
      taggedMsgId = r4.rows[0].id;
      // POST /api/rooms が "TODO" タグを default で作るのでそれを使う
      const tagRes = await pool.query(
        `SELECT id FROM tags WHERE room_id = $1 AND name = 'TODO'`,
        [roomId]
      );
      await pool.query(
        `INSERT INTO message_tags (message_id, tag_id, is_done) VALUES ($1, $2, false)`,
        [taggedMsgId, tagRes.rows[0].id]
      );

      // 別ルーム (bot 不在) に「削除」を含むメッセージ
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '別ルームの削除に関する話')`,
        [otherRoomId, user2.user.id]
      );

      // 過去日付メッセージ (since/until テスト用)
      const oldRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content, created_at) VALUES ($1, $2, 'text', '昔の削除話', '2026-01-01T00:00:00Z') RETURNING id`,
        [roomId, user1.user.id]
      );
      oldMsgId = oldRes.rows[0].id;

      // 削除済メッセージ
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content, is_deleted) VALUES ($1, $2, 'text', '削除済の発言です', true)`,
        [roomId, user1.user.id]
      );
    });

    it('1. 単純キーワード検索: results に該当メッセージが入る', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除確認')}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results.some(r => r.message_id === textMsgId)).toBe(true);
    });

    it('2. voice transcription を q でヒット', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('音声メッセージ')}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      const found = res.body.results.find(r => r.message_id === voiceMsgId);
      expect(found).toBeDefined();
      expect(found.type).toBe('voice');
      expect(found.snippet).toContain('音声メッセージ');
    });

    it('3. room_id で絞ると他ルームのメッセージが含まれない', async () => {
      // bot を別ルームに参加させて、両方含む状態にしてから絞り込みを確認
      await request(app)
        .post(`/api/bot/rooms/${otherRoomId}/join`)
        .set('Authorization', `Bearer ${bot.token}`);

      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除')}&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.room_id === roomId)).toBe(true);
    });

    it('4. sender_id で絞ると該当ユーザの発言のみ', async () => {
      const res = await request(app)
        .get(`/api/bot/search?sender_id=${user1.user.id}&since=2026-04-01T00:00:00Z`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.sender_id === user1.user.id)).toBe(true);
    });

    it('5. type=image で画像メッセージのみ', async () => {
      const res = await request(app)
        .get(`/api/bot/search?type=image&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.type === 'image')).toBe(true);
      expect(res.body.results.some(r => r.message_id === imageMsgId)).toBe(true);
    });

    it('6. tag_names + is_done で TODO を絞れる', async () => {
      const res = await request(app)
        .get(`/api/bot/search?tag_names=TODO&is_done=false&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.some(r => r.message_id === taggedMsgId)).toBe(true);
    });

    it('7. since/until で期間外メッセージが含まれない', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除')}&since=2026-04-01T00:00:00Z&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.message_id !== oldMsgId)).toBe(true);
    });

    it('8. limit + offset でページング、has_more と next_offset が整合', async () => {
      // 追加で大量に投入
      const pool = getTestPool();
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', $3)`,
          [roomId, user1.user.id, `削除関連メモ ${i}`]
        );
      }
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除')}&room_id=${roomId}&limit=3`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(3);
      expect(res.body.has_more).toBe(true);
      expect(res.body.next_offset).toBe(3);
    });

    it('9. 全パラメータ省略で 400', async () => {
      const res = await request(app)
        .get('/api/bot/search?limit=10')
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(400);
    });

    it('10. 非メンバールームのメッセージは見えない', async () => {
      // bot は room2 (otherRoomId) に参加していない
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('別ルームの削除')}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.every(r => r.room_id !== otherRoomId)).toBe(true);
    });

    it('11. 認証なしで 401', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=test`);
      expect(res.status).toBe(401);
    });

    it('12. 削除メッセージは含まない', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除済の発言')}&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(0);
    });

    it('13. snippet にハイライトが含まれる', async () => {
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('削除確認')}&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      const hit = res.body.results.find(r => r.message_id === textMsgId);
      expect(hit).toBeDefined();
      expect(hit.snippet).toContain('**削除確認**');
    });

    it('14. snippet 切り詰め (200 文字超は ... が前後に)', async () => {
      // 長文メッセージを投入
      const pool = getTestPool();
      const longText = 'あ'.repeat(150) + 'キーワード' + 'い'.repeat(150);
      const longRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', $3) RETURNING id`,
        [roomId, user1.user.id, longText]
      );
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('キーワード')}&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      const hit = res.body.results.find(r => r.message_id === longRes.rows[0].id);
      expect(hit).toBeDefined();
      expect(hit.snippet.startsWith('...')).toBe(true);
      expect(hit.snippet.endsWith('...')).toBe(true);
      expect(hit.snippet).toContain('**キーワード**');
    });

    it('15. room_id + since のみで成功 (B1: 今日の業務メモ ケース、UNION 不要 path)', async () => {
      const res = await request(app)
        .get(`/api/bot/search?room_id=${roomId}&since=2026-04-01T00:00:00Z`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      // 期間外 (oldMsgId、2026-01-01) は含まれない
      expect(res.body.results.every(r => r.message_id !== oldMsgId)).toBe(true);
    });

    it('16. q に LIKE wildcard 文字 (%) を含めても誤動作しない', async () => {
      // "50%" は SQL LIKE wildcard が誤動作すれば全件マッチしてしまう
      const pool = getTestPool();
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', '達成率 50% を超えた')`,
        [roomId, user1.user.id]
      );
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'ワイルドカードを含まない普通の発言')`,
        [roomId, user1.user.id]
      );
      const res = await request(app)
        .get(`/api/bot/search?q=${encodeURIComponent('50%')}&room_id=${roomId}`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      // "50%" を含む発言だけがヒットすべき (% を wildcard 解釈してしまうと全件ヒットになる)
      expect(res.body.results.every(r => r.snippet.includes('50%'))).toBe(true);
    });
  });

  // ============================================
  // PATCH /api/bot/messages/:id/tags/:tag_name/done (#197)
  // ============================================
  // ============================================
  // GET /api/bot/tags (#254 — list_tags discovery primitive)
  // ============================================
  describe('GET /api/bot/tags', () => {
    beforeEach(async () => {
      const pool = getTestPool();
      // bot を別 room にも配置、cross-room aggregation を test
      const room2Res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'テストルーム 2', member_ids: [bot.user.id] });
      const room2Id = room2Res.body.room.id;

      // room1 に独自 tag, room2 に別 tag を仕込む (POST /api/rooms で default "TODO" tag が作られている)
      await pool.query(
        `INSERT INTO tags (room_id, name, is_todo) VALUES
          ($1, 'feedback', false),
          ($2, 'tealus関係', true)`,
        [roomId, room2Id]
      );
    });

    it('1. bot が auth で全 room の tag 集計を取得', async () => {
      const res = await request(app)
        .get('/api/bot/tags')
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.tags)).toBe(true);
      const names = res.body.tags.map(t => t.name);
      expect(names).toContain('TODO');
      expect(names).toContain('feedback');
      expect(names).toContain('tealus関係');
      // tealus関係 は is_todo=true で出ること
      const tealusTag = res.body.tags.find(t => t.name === 'tealus関係');
      expect(tealusTag.is_todo).toBe(true);
      expect(typeof tealusTag.total_usage).toBe('number');
    });

    it('2. 認証なし → 401', async () => {
      const res = await request(app).get('/api/bot/tags');
      expect(res.status).toBe(401);
    });

    it('3. limit query で件数を制限', async () => {
      const res = await request(app)
        .get('/api/bot/tags?limit=1')
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.tags.length).toBe(1);
    });

    it('4. bot が member でない room の tag は含まない', async () => {
      const user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
      const orphanRoomRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: 'bot 非メンバー room', member_ids: [] });
      const orphanRoomId = orphanRoomRes.body.room.id;
      const pool = getTestPool();
      await pool.query(
        `INSERT INTO tags (room_id, name, is_todo) VALUES ($1, 'orphan-only-tag', false)`,
        [orphanRoomId]
      );

      const res = await request(app)
        .get('/api/bot/tags')
        .set('Authorization', `Bearer ${bot.token}`);
      const names = res.body.tags.map(t => t.name);
      expect(names).not.toContain('orphan-only-tag');
    });
  });

  describe('PATCH /api/bot/messages/:id/tags/:tag_name/done', () => {
    let messageId, tagId;

    beforeEach(async () => {
      const pool = getTestPool();
      const msgRes = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'テスト用 TODO 発言') RETURNING id`,
        [roomId, user1.user.id]
      );
      messageId = msgRes.rows[0].id;
      // POST /api/rooms が default の "TODO" タグを作るのでそれを使う
      const tagRes = await pool.query(
        `SELECT id FROM tags WHERE room_id = $1 AND name = 'TODO'`,
        [roomId]
      );
      tagId = tagRes.rows[0].id;
      await pool.query(
        `INSERT INTO message_tags (message_id, tag_id, is_done) VALUES ($1, $2, false)`,
        [messageId, tagId]
      );
    });

    it('1. is_done=true に更新 (room メンバー bot)', async () => {
      const res = await request(app)
        .patch(`/api/bot/messages/${messageId}/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.is_done).toBe(true);

      // DB 反映確認
      const pool = getTestPool();
      const verifyRes = await pool.query(
        `SELECT is_done FROM message_tags WHERE message_id = $1 AND tag_id = $2`,
        [messageId, tagId]
      );
      expect(verifyRes.rows[0].is_done).toBe(true);
    });

    it('2. is_done=false に戻す', async () => {
      const pool = getTestPool();
      await pool.query(
        `UPDATE message_tags SET is_done = true WHERE message_id = $1 AND tag_id = $2`,
        [messageId, tagId]
      );
      const res = await request(app)
        .patch(`/api/bot/messages/${messageId}/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: false });
      expect(res.status).toBe(200);
      expect(res.body.is_done).toBe(false);
    });

    it('3. 非メンバー bot は 404 (メッセージ非可視)', async () => {
      // bot 不在ルームを作成し、そこにメッセージを置く
      const user2 = await createTestUser({ login_id: 'EMP004', display_name: '別ユーザ4' });
      const otherRoomRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: '不在ルーム', member_ids: [] });
      const otherRoomId = otherRoomRes.body.room.id;
      const pool = getTestPool();
      const otherMsg = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'X') RETURNING id`,
        [otherRoomId, user2.user.id]
      );

      const res = await request(app)
        .patch(`/api/bot/messages/${otherMsg.rows[0].id}/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: true });
      expect(res.status).toBe(404);
    });

    it('4. 不明 message で 404', async () => {
      const res = await request(app)
        .patch(`/api/bot/messages/00000000-0000-0000-0000-000000000000/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: true });
      expect(res.status).toBe(404);
    });

    it('5. 不明 tag_name で 404', async () => {
      const res = await request(app)
        .patch(`/api/bot/messages/${messageId}/tags/UnknownTag/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: true });
      expect(res.status).toBe(404);
    });

    it('6. message に tag が付いていない場合 404', async () => {
      // 別 message (tag 未付与)
      const pool = getTestPool();
      const noTagMsg = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'no tag') RETURNING id`,
        [roomId, user1.user.id]
      );
      const res = await request(app)
        .patch(`/api/bot/messages/${noTagMsg.rows[0].id}/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ is_done: true });
      expect(res.status).toBe(404);
    });

    it('7. body に is_done が無いと 400', async () => {
      const res = await request(app)
        .patch(`/api/bot/messages/${messageId}/tags/TODO/done`)
        .set('Authorization', `Bearer ${bot.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('8. 認証なしで 401', async () => {
      const res = await request(app)
        .patch(`/api/bot/messages/${messageId}/tags/TODO/done`)
        .send({ is_done: true });
      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // GET /api/bot/rooms
  // ============================================
  describe('GET /api/bot/rooms', () => {
    it('should return rooms bot belongs to', async () => {
      const res = await request(app)
        .get('/api/bot/rooms')
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      expect(res.body.rooms.length).toBe(1);
      expect(res.body.rooms[0].name).toBe('テストルーム');
    });
  });

  // ============================================
  // POST /api/bot/rooms/:id/join
  // ============================================
  describe('POST /api/bot/rooms/:id/join', () => {
    it('should join a room', async () => {
      // Create a room without bot
      const user2 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });
      const room2Res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: '新しいルーム', member_ids: [] });

      const res = await request(app)
        .post(`/api/bot/rooms/${room2Res.body.room.id}/join`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);

      // Verify bot can now send messages
      const msgRes = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: room2Res.body.room.id, content: '参加しました' });

      expect(msgRes.status).toBe(201);
    });

    it('should not duplicate membership', async () => {
      const res = await request(app)
        .post(`/api/bot/rooms/${roomId}/join`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
    });
  });

  // ============================================
  // GET /api/bot/rooms/:id/membership (#282: 委譲の権限チェック)
  // ============================================
  describe('GET /api/bot/rooms/:id/membership', () => {
    it('should return is_member:true for a member of the room', async () => {
      const res = await request(app)
        .get(`/api/bot/rooms/${roomId}/membership`)
        .query({ user_id: user1.user.id })
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      expect(res.body.is_member).toBe(true);
    });

    it('should return is_member:false for a non-member', async () => {
      const user2 = await createTestUser({ login_id: 'EMP010', display_name: '非メンバー' });
      const res = await request(app)
        .get(`/api/bot/rooms/${roomId}/membership`)
        .query({ user_id: user2.user.id })
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(200);
      expect(res.body.is_member).toBe(false);
    });

    it('should 400 without user_id', async () => {
      const res = await request(app)
        .get(`/api/bot/rooms/${roomId}/membership`)
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(400);
    });

    it('should 403 when bot is not a member of the room (least privilege)', async () => {
      const user2 = await createTestUser({ login_id: 'EMP011', display_name: '佐藤' });
      const botlessRes = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'bot不在ルーム', member_ids: [user2.user.id] });

      const res = await request(app)
        .get(`/api/bot/rooms/${botlessRes.body.room.id}/membership`)
        .query({ user_id: user1.user.id })
        .set('Authorization', `Bearer ${bot.token}`);

      expect(res.status).toBe(403);
    });
  });

  // ============================================
  // GET /api/bot/messages/:id/edit-history
  // (= 5/24 user 提案、organon daily cycle で edit history 観察用、別 mining script の代替)
  // ============================================
  describe('GET /api/bot/messages/:id/edit-history', () => {
    let textMsgId, voiceMsgId;

    beforeEach(async () => {
      const pool = getTestPool();
      // text message (edited)
      const textMsg = await request(app)
        .post('/api/bot/push')
        .set('Authorization', `Bearer ${bot.token}`)
        .send({ room_id: roomId, content: 'original text' });
      textMsgId = textMsg.body.message.id;
      // simulate edit (= insert into message_edits + flip is_edited)
      await pool.query(
        'INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, 1, $2, $3)',
        [textMsgId, 'original text', bot.user.id]
      );
      await pool.query("UPDATE messages SET content = $1, is_edited = true WHERE id = $2", ['edited text', textMsgId]);

      // voice message with multi-version transcription
      const voiceMsg = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'voice', '') RETURNING id`,
        [roomId, user1.user.id]
      );
      voiceMsgId = voiceMsg.rows[0].id;
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, version, raw_text, formatted_text, status, edited_by)
         VALUES ($1, 1, 'raw v1', 'formatted v1', 'done', $2),
                ($1, 2, 'raw v1', 'user corrected', 'done', $3)`,
        [voiceMsgId, user1.user.id, user1.user.id]
      );
    });

    it('returns text edit history for edited text message', async () => {
      const res = await request(app)
        .get(`/api/bot/messages/${textMsgId}/edit-history`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.message_id).toBe(textMsgId);
      expect(res.body.type).toBe('text');
      expect(res.body.is_edited).toBe(true);
      expect(res.body.current_content).toBe('edited text');
      expect(res.body.text_edit_history).toHaveLength(1);
      expect(res.body.text_edit_history[0].content).toBe('original text');
      expect(res.body.voice_transcription_versions).toEqual([]);
    });

    it('returns voice transcription versions for voice message', async () => {
      const res = await request(app)
        .get(`/api/bot/messages/${voiceMsgId}/edit-history`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('voice');
      expect(res.body.voice_transcription_versions).toHaveLength(2);
      expect(res.body.voice_transcription_versions[0].version).toBe(1);
      expect(res.body.voice_transcription_versions[0].raw_text).toBe('raw v1');
      expect(res.body.voice_transcription_versions[0].formatted_text).toBe('formatted v1');
      expect(res.body.voice_transcription_versions[1].version).toBe(2);
      expect(res.body.voice_transcription_versions[1].formatted_text).toBe('user corrected');
      expect(res.body.text_edit_history).toEqual([]);
    });

    it('returns 404 for nonexistent message', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/bot/messages/${fakeId}/edit-history`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(404);
    });

    it('returns 403 when bot is not a member of the room', async () => {
      const pool = getTestPool();
      const otherRoom = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '別ルーム', member_ids: [] });
      const otherMsg = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type, content) VALUES ($1, $2, 'text', 'private') RETURNING id`,
        [otherRoom.body.room.id, user1.user.id]
      );
      const res = await request(app)
        .get(`/api/bot/messages/${otherMsg.rows[0].id}/edit-history`)
        .set('Authorization', `Bearer ${bot.token}`);
      expect(res.status).toBe(403);
    });
  });
});
