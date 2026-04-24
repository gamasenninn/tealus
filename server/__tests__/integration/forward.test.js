const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Message Forward (#166)', () => {
  let user1, user2, roomA, roomB;

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

    // Create two rooms, both with user1 and user2
    const roomARes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: '業務メモ', member_ids: [user2.user.id] });
    roomA = roomARes.body.room.id;

    const roomBRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'Web部', member_ids: [user2.user.id] });
    roomB = roomBRes.body.room.id;
  });

  describe('POST /api/rooms/:id/messages with forwarded_from', () => {
    it('should create a forwarded message with forwarded_from reference', async () => {
      // Send original message to roomA
      const origRes = await request(app)
        .post(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '元のメッセージです' });

      expect(origRes.status).toBe(201);
      const origId = origRes.body.message.id;

      // Forward to roomB
      const fwdRes = await request(app)
        .post(`/api/rooms/${roomB}/messages`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ content: '元のメッセージです', forwarded_from: origId });

      expect(fwdRes.status).toBe(201);
      expect(fwdRes.body.message.forwarded_from).toBe(origId);
      expect(fwdRes.body.message.room_id).toBe(roomB);
    });

    it('should accept messages without forwarded_from (backward compatible)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '普通のメッセージ' });

      expect(res.status).toBe(201);
      expect(res.body.message.forwarded_from).toBeNull();
    });
  });

  describe('GET /api/rooms/:id/messages attaches forwarded_from_message', () => {
    it('should include forwarded_from_message with room_name and sender info', async () => {
      // Send original to roomA
      const origRes = await request(app)
        .post(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '転送される元メッセージ' });
      const origId = origRes.body.message.id;

      // Forward to roomB
      await request(app)
        .post(`/api/rooms/${roomB}/messages`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ content: '転送される元メッセージ', forwarded_from: origId });

      // Fetch roomB messages
      const listRes = await request(app)
        .get(`/api/rooms/${roomB}/messages`)
        .set('Authorization', `Bearer ${user2.token}`);

      expect(listRes.status).toBe(200);
      const fwdMsg = listRes.body.messages.find(m => m.forwarded_from === origId);
      expect(fwdMsg).toBeDefined();
      expect(fwdMsg.forwarded_from_message).toBeDefined();
      expect(fwdMsg.forwarded_from_message.content).toBe('転送される元メッセージ');
      expect(fwdMsg.forwarded_from_message.room_name).toBe('業務メモ');
      expect(fwdMsg.forwarded_from_message.sender_display_name).toBe('田中太郎');
    });

    it('should return forwarded_from_message as null when original is deleted', async () => {
      // Send original
      const origRes = await request(app)
        .post(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '削除される予定の元メッセージ' });
      const origId = origRes.body.message.id;

      // Forward
      await request(app)
        .post(`/api/rooms/${roomB}/messages`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ content: '削除される予定の元メッセージ', forwarded_from: origId });

      // Delete original
      await request(app)
        .delete(`/api/rooms/${roomA}/messages/${origId}`)
        .set('Authorization', `Bearer ${user1.token}`);

      // Fetch roomB messages
      const listRes = await request(app)
        .get(`/api/rooms/${roomB}/messages`)
        .set('Authorization', `Bearer ${user2.token}`);

      const fwdMsg = listRes.body.messages.find(m => m.forwarded_from === origId);
      expect(fwdMsg).toBeDefined();
      // Deleted message should have forwarded_from_message as null
      expect(fwdMsg.forwarded_from_message).toBeNull();
    });

    it('should not include forwarded_from_message for normal messages', async () => {
      await request(app)
        .post(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ content: '普通のメッセージ' });

      const listRes = await request(app)
        .get(`/api/rooms/${roomA}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(listRes.status).toBe(200);
      const msg = listRes.body.messages[0];
      expect(msg.forwarded_from).toBeNull();
      expect(msg.forwarded_from_message).toBeNull();
    });
  });
});
