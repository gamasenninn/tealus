const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Reply Feature', () => {
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

  it('should send a reply to a message', async () => {
    // Send original message
    const origRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'こんにちは' });
    const originalId = origRes.body.message.id;

    // Send reply
    const replyRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ content: 'こんにちは！元気？', reply_to: originalId });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.message.reply_to).toBe(originalId);
  });

  it('should include reply_to message info in history', async () => {
    const origRes = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: '元のメッセージ' });
    const originalId = origRes.body.message.id;

    await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user2.token}`)
      .send({ content: 'リプライです', reply_to: originalId });

    const res = await request(app)
      .get(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`);

    // Most recent message is the reply
    const reply = res.body.messages[0];
    expect(reply.content).toBe('リプライです');
    expect(reply.reply_to).toBe(originalId);
    expect(reply.reply_to_message).toBeDefined();
    expect(reply.reply_to_message.content).toBe('元のメッセージ');
    expect(reply.reply_to_message.sender_display_name).toBe('田中太郎');
  });

  it('should handle reply to non-existent message gracefully', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: 'リプライ', reply_to: '00000000-0000-0000-0000-000000000000' });

    // Should fail due to foreign key constraint
    expect(res.status).toBe(500);
  });

  it('should work without reply_to (normal message)', async () => {
    const res = await request(app)
      .post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ content: '普通のメッセージ' });

    expect(res.status).toBe(201);
    expect(res.body.message.reply_to).toBeNull();
  });
});
