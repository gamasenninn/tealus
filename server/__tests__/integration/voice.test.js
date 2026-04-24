const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

// Create a minimal webm audio fixture
const fixturesDir = path.join(__dirname, '../fixtures');

function ensureVoiceFixture() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const voicePath = path.join(fixturesDir, 'test.webm');
  if (!fs.existsSync(voicePath)) {
    // Create a minimal valid file for testing
    fs.writeFileSync(voicePath, Buffer.alloc(1024, 0));
  }
  return voicePath;
}

describe('Voice Message API', () => {
  let user1, user2, roomId;
  let voicePath;

  beforeAll(async () => {
    await setupTestDb();
    voicePath = ensureVoiceFixture();
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

  describe('POST /api/rooms/:id/voice', () => {
    it('should upload a voice message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/voice`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('voice', voicePath);

      expect(res.status).toBe(201);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.type).toBe('voice');
      expect(res.body.media).toBeDefined();
      expect(res.body.media.file_path).toContain('voices/');
    });

    it('should reject without file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/voice`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
    });

    it('should reject non-member', async () => {
      const user3 = await createTestUser({ login_id: 'EMP003', display_name: '佐藤次郎' });
      const res = await request(app)
        .post(`/api/rooms/${roomId}/voice`)
        .set('Authorization', `Bearer ${user3.token}`)
        .attach('voice', voicePath);

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/voice`);

      expect(res.status).toBe(401);
    });

    it('should include voice message in message history', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/voice`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('voice', voicePath);

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].type).toBe('voice');
      expect(res.body.messages[0].media).toBeDefined();
      expect(res.body.messages[0].media.length).toBeGreaterThan(0);
    });
  });
});
