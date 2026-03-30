const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

const fixturesDir = path.join(__dirname, '../fixtures');

function ensureVoiceFixture() {
  const voicePath = path.join(fixturesDir, 'test.webm');
  if (!fs.existsSync(voicePath)) {
    fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
  }
  return voicePath;
}

describe('Transcription Edit API', () => {
  let user1, user2, roomId, messageId, voicePath;

  beforeAll(async () => {
    await setupTestDb();
    voicePath = ensureVoiceFixture();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ employee_id: 'EMP002', display_name: '鈴木花子' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;

    // Create voice message
    const uploadRes = await request(app)
      .post(`/api/rooms/${roomId}/voice`)
      .set('Authorization', `Bearer ${user1.token}`)
      .attach('voice', voicePath);
    messageId = uploadRes.body.message.id;

    // Wait for async process to settle, then simulate completion
    await new Promise(r => setTimeout(r, 500));
    const pool = getTestPool();
    await pool.query(
      `UPDATE voice_transcriptions SET status = 'done', raw_text = '元のテキスト', formatted_text = '整形済みテキスト' WHERE message_id = $1`,
      [messageId]
    );
  });

  // ============================================
  // PUT /api/messages/:id/transcription
  // ============================================
  describe('PUT /api/messages/:id/transcription', () => {
    it('should edit transcription text', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集後のテキスト' });

      expect(res.status).toBe(200);
      expect(res.body.transcription.formatted_text).toBe('編集後のテキスト');
      expect(res.body.transcription.version).toBe(2);
    });

    it('should reject edit by non-sender', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ text: '不正な編集' });

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .send({ text: 'test' });

      expect(res.status).toBe(401);
    });

    it('should reject empty text', async () => {
      const res = await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '' });

      expect(res.status).toBe(400);
    });
  });

  // ============================================
  // GET /api/messages/:id/transcription/history
  // ============================================
  describe('GET /api/messages/:id/transcription/history', () => {
    it('should return edit history', async () => {
      // Edit twice
      await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集v2' });

      await request(app)
        .put(`/api/messages/${messageId}/transcription`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ text: '編集v3' });

      const res = await request(app)
        .get(`/api/messages/${messageId}/transcription/history`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.history.length).toBe(3); // v1(original) + v2 + v3
      expect(res.body.history[0].version).toBe(3); // newest first
      expect(res.body.history[2].version).toBe(1);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ employee_id: 'EMP003', display_name: '佐藤次郎' });
      const res = await request(app)
        .get(`/api/messages/${messageId}/transcription/history`)
        .set('Authorization', `Bearer ${user3.token}`);

      expect(res.status).toBe(403);
    });
  });
});
