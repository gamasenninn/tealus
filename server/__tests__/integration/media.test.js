const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

// Create test fixtures directory and files
const fixturesDir = path.join(__dirname, '../fixtures');

async function ensureFixtures() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  // Create a valid PNG using sharp
  const pngPath = path.join(fixturesDir, 'test.png');
  if (!fs.existsSync(pngPath)) {
    const sharp = require('sharp');
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } }
    }).png().toFile(pngPath);
  }

  // Create a small text file
  const txtPath = path.join(fixturesDir, 'test.txt');
  if (!fs.existsSync(txtPath)) {
    fs.writeFileSync(txtPath, 'テストファイル');
  }

  return { pngPath, txtPath };
}

describe('Media API', () => {
  let user1, user2, user3, roomId;
  let fixtures;

  beforeAll(async () => {
    await setupTestDb();
    fixtures = await ensureFixtures();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '田中太郎' });
    user2 = await createTestUser({ employee_id: 'EMP002', display_name: '鈴木花子' });
    user3 = await createTestUser({ employee_id: 'EMP003', display_name: '佐藤次郎' });

    const roomRes = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${user1.token}`)
      .send({ name: 'テストルーム', member_ids: [user2.user.id] });
    roomId = roomRes.body.room.id;
  });

  // ============================================
  // POST /api/rooms/:id/media
  // ============================================
  describe('POST /api/rooms/:id/media', () => {
    it('should upload an image and create a message', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('file', fixtures.pngPath);

      expect(res.status).toBe(201);
      expect(res.body.message).toBeDefined();
      expect(res.body.message.type).toBe('image');
      expect(res.body.media).toBeDefined();
      expect(res.body.media.mime_type).toBe('image/png');
      expect(res.body.media.file_path).toBeDefined();
      expect(res.body.media.thumbnail_path).toBeDefined();
    });

    it('should upload a generic file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('file', fixtures.txtPath);

      expect(res.status).toBe(201);
      expect(res.body.message.type).toBe('file');
      expect(res.body.media.mime_type).toBe('text/plain');
      expect(res.body.media.thumbnail_path).toBeNull();
    });

    it('should reject upload without file', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
    });

    it('should reject non-member from uploading', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user3.token}`)
        .attach('file', fixtures.pngPath);

      expect(res.status).toBe(403);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/media`);

      expect(res.status).toBe(401);
    });

    it('should include media info in message history', async () => {
      await request(app)
        .post(`/api/rooms/${roomId}/media`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('file', fixtures.pngPath);

      const res = await request(app)
        .get(`/api/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].type).toBe('image');
      expect(res.body.messages[0].media).toBeDefined();
      expect(res.body.messages[0].media.length).toBeGreaterThan(0);
    });
  });
});
