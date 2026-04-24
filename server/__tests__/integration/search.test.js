const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Search API', () => {
  let user1, user2, user3, room1Id, room2Id;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ login_id: 'EMP002', display_name: '鈴木花子' });
    user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

    // Create two rooms
    const room1Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'Web部', member_ids: [user2.user.id] });
    room1Id = room1Res.body.room.id;

    const room2Res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: '営業部', member_ids: [user2.user.id] });
    room2Id = room2Res.body.room.id;

    // Send messages
    await request(app)
      .post(`/api/rooms/${room1Id}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'のらぼう菜が美味しかった' });

    await request(app)
      .post(`/api/rooms/${room1Id}/messages`)
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ content: '明日の会議は10時からです' });

    await request(app)
      .post(`/api/rooms/${room2Id}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: '会議の資料を送ります' });
  });

  describe('GET /api/search', () => {
    it('should search across all rooms', async () => {
      const res = await request(app)
        .get('/api/search?q=会議')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(2);
      expect(res.body.results[0].content).toContain('会議');
    });

    it('should search within a specific room', async () => {
      const res = await request(app)
        .get(`/api/search?q=会議&room_id=${room1Id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(1);
    });

    it('should search voice transcriptions', async () => {
      // Create voice message with transcription
      const pool = getTestPool();
      const msgResult = await pool.query(
        `INSERT INTO messages (room_id, sender_id, type) VALUES ($1, $2, 'voice') RETURNING id`,
        [room1Id, user1.user.id]
      );
      await pool.query(
        `INSERT INTO voice_transcriptions (message_id, version, formatted_text, status)
         VALUES ($1, 1, '音声テストの文字起こしです', 'done')`,
        [msgResult.rows[0].id]
      );

      const res = await request(app)
        .get('/api/search?q=文字起こし')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(1);
      expect(res.body.results[0].type).toBe('voice');
    });

    it('should only return results from rooms user belongs to', async () => {
      // user3 is not a member of any room
      const res = await request(app)
        .get('/api/search?q=会議')
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(200);
      expect(res.body.results.length).toBe(0);
    });

    it('should reject without query', async () => {
      const res = await request(app)
        .get('/api/search')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await request(app).get('/api/search?q=test');
      expect(res.status).toBe(401);
    });

    it('should include room name and sender info', async () => {
      const res = await request(app)
        .get('/api/search?q=のらぼう')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.results[0].sender_display_name).toBe('田中太郎');
      expect(res.body.results[0].room_name).toBeDefined();
    });
  });
});
