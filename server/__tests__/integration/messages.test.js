const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Messages API', () => {
  let user1, user2, user3, roomId;

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

    // Create a group room with user1 and user2
    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/rooms/:id/messages
  // ============================================
  describe('POST /api/rooms/:id/messages', () => {
    it('should send a text message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'こんにちは！' });

      expect(res.status).toBe(201);
      expect(res.body.message.content).toBe('こんにちは！');
      expect(res.body.message.sender_id).toBe(user1.user.id);
      expect(res.body.message.room_id).toBe(roomId);
      expect(res.body.message.type).toBe('text');
    });

    it('should reject empty message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '' });

      expect(res.status).toBe(400);
    });

    it('should reject non-member from sending', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user3.token}`)
        .send({ content: '侵入メッセージ' });

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .send({ content: 'no auth' });

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // GET /api/rooms/:id/messages
  // ============================================
  describe('GET /api/rooms/:id/messages', () => {
    beforeEach(async () => {
      // Send multiple messages
      for (let i = 1; i <= 25; i++) {
        await request(app)
          .post(`/api/rooms/${roomId}/messages`)
          .set('Authorization', `Bearer ${user1.token}`)
          .send({ content: `メッセージ${i}` });
      }
    });

    it('should return messages (default limit 20)', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(20);
      // Should be newest first
      expect(res.body.messages[0].content).toBe('メッセージ25');
    });

    it('should support pagination with cursor', async () => {
      const page1 = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const lastMessage = page1.body.messages[page1.body.messages.length - 1];

      const page2 = await request(app)
        .get(`/api/rooms/${roomId}/messages?before=${lastMessage.id}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(page2.status).toBe(200);
      expect(page2.body.messages).toHaveLength(5); // 25 - 20 = 5
      expect(page2.body.messages[0].content).toBe('メッセージ5');
    });

    it('should support custom limit', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=5`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages).toHaveLength(5);
    });

    it('should reject non-member from reading', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });

    it('should include sender info', async () => {
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages?limit=1`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages[0].sender_display_name).toBe('田中太郎');
    });
  });
});
