const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Read Status API', () => {
  let user1, user2, roomId;

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ employee_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms/direct')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ partner_id: user2.user.id });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // Unread count (room list)
  // ============================================
  describe('Unread count', () => {
    it('should show unread count in room list', async () => {
      // user1 sends 3 messages
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/rooms/${roomId}/messages`)
          .set('Authorization', `Bearer ${user1.token}`)
          .send({ content: `msg${i}` });
      }

      // user2 checks room list — should have 3 unread
      const res = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(200);
      const room = res.body.rooms.find(r => r.id === roomId);
      expect(room.unread_count).toBe(3);
    });

    it('should show 0 unread for sender', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'hello' });

      const res = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user1.token}`);

      const room = res.body.rooms.find(r => r.id === roomId);
      // Sender's own messages should not be unread
      expect(room.unread_count).toBe(0);
    });
  });

  // ============================================
  // POST /api/rooms/:id/read — Mark as read
  // ============================================
  describe('POST /api/rooms/:id/read', () => {
    it('should mark messages as read and reset unread count', async () => {
      // user1 sends messages
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'hello' });
      const messageId = msgRes.body.message.id;

      // user2 marks as read
      const readRes = await request(app)
        .post(`/api/rooms/${roomId}/read`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ message_ids: [messageId] });

      expect(readRes.status).toBe(200);

      // Check unread count is now 0
      const listRes = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`);

      const room = listRes.body.rooms.find(r => r.id === roomId);
      expect(room.unread_count).toBe(0);
    });
  });

  // ============================================
  // Read count (chat view)
  // ============================================
  describe('Read count on messages', () => {
    it('should show read count on messages', async () => {
      // user1 sends a message
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'hello' });
      const messageId = msgRes.body.message.id;

      // user2 reads it
      await request(app)
        .post(`/api/rooms/${roomId}/read`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ message_ids: [messageId] });

      // user1 gets messages — should see read_count = 1
      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const msg = res.body.messages.find(m => m.id === messageId);
      expect(msg.read_count).toBe(1);
    });

    it('should show read_count 0 for unread messages', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'hello' });

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages[0].read_count).toBe(0);
    });
  });

  // ============================================
  // POST /api/rooms/:id/read/all — Mark all as read
  // ============================================
  describe('POST /api/rooms/:id/read/all', () => {
    it('should mark all unread messages as read', async () => {
      // user1 sends 5 messages
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post(`/api/rooms/${roomId}/messages`)
          .set('Authorization', `Bearer ${user1.token}`)
          .send({ content: `msg${i}` });
      }

      // user2 has 5 unread
      let listRes = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`);
      let room = listRes.body.rooms.find(r => r.id === roomId);
      expect(room.unread_count).toBe(5);

      // user2 marks all as read
      const res = await request(app)
        .post(`/api/rooms/${roomId}/read/all`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(5);

      // user2 now has 0 unread
      listRes = await request(app)
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user2.token}`);
      room = listRes.body.rooms.find(r => r.id === roomId);
      expect(room.unread_count).toBe(0);
    });

    it('should return count 0 when no unread messages', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/read/all`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('should not mark own messages as read', async () => {
      // user1 sends messages
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/rooms/${roomId}/messages`)
          .set('Authorization', `Bearer ${user1.token}`)
          .send({ content: `msg${i}` });
      }

      // user1 marks all as read — own messages should be skipped
      const res = await request(app)
        .post(`/api/rooms/${roomId}/read/all`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('should update read counts on messages', async () => {
      // user1 sends a message
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'hello' });

      // user2 marks all as read
      await request(app)
        .post(`/api/rooms/${roomId}/read/all`)
        .set('Authorization', `Bearer ${user2.token}`);

      // user1 sees read_count = 1
      const msgs = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const msg = msgs.body.messages.find(m => m.id === msgRes.body.message.id);
      expect(msg.read_count).toBe(1);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ employee_id: 'EMP003', display_name: '佐藤次郎' });
      const res = await request(app)
        .post(`/api/rooms/${roomId}/read/all`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });
});
