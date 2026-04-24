const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Message Delete API', () => {
  let user1, user2, roomId;

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

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  describe('DELETE /api/rooms/:id/messages/:msgId', () => {
    it('should soft-delete own message', async () => {
      // Send a message
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '削除テスト' });
      const msgId = msgRes.body.message.id;

      // Delete it
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);

      // Verify it shows as deleted in history
      const histRes = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      const deleted = histRes.body.messages.find(m => m.id === msgId);
      expect(deleted.is_deleted).toBe(true);
    });

    it('should reject deleting other users message', async () => {
      // user1 sends
      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '他人のメッセージ' });

      // user2 tries to delete
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgRes.body.message.id}`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/00000000-0000-0000-0000-000000000000`);

      expect(res.status).toBe(401);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });

      const msgRes = await request(app)
        .post(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: 'テスト' });

      const res = await request(app)
        .delete(`/api/rooms/${roomId}/messages/${msgRes.body.message.id}`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });
});
