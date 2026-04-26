const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

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
});
