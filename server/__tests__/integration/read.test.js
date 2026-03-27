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
});
