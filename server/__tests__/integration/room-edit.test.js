const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

const fixturesDir = path.join(__dirname, '../fixtures');

async function ensureIconFixture() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const iconPath = path.join(fixturesDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    const sharp = require('sharp');
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 180, b: 160 } }
    }).png().toFile(iconPath);
  }
  return iconPath;
}

describe('Room Edit API', () => {
  let admin, user1, groupId, iconPath;

  beforeAll(async () => {
    await setupTestDb();
    iconPath = await ensureIconFixture();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ employee_id: 'ADMIN01', display_name: '田中太郎' });
    user1 = await createTestUser({ employee_id: 'EMP001', display_name: '鈴木花子' });

    const res = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テストグループ', member_ids: [user1.user.id] });
    groupId = res.body.room.id;
  });

  describe('PUT /api/rooms/:id', () => {
    it('should update group name (admin only)', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: '新しいグループ名' });

      expect(res.status).toBe(200);
      expect(res.body.room.name).toBe('新しいグループ名');
    });

    it('should reject by non-admin', async () => {
      const res = await request(app)
        .put(`/api/rooms/${groupId}`)
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: '不正な変更' });

      expect(res.status).toBe(403);
    });

    it('should reject on direct room', async () => {
      const directRes = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ partner_id: user1.user.id });

      const res = await request(app)
        .put(`/api/rooms/${directRes.body.room.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'test' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/rooms/:id/icon', () => {
    it('should upload group icon (admin only)', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/icon`)
        .set('Authorization', `Bearer ${admin.token}`)
        .attach('icon', iconPath);

      expect(res.status).toBe(200);
      expect(res.body.room.icon_url).toContain('icons/');
    });

    it('should reject by non-admin', async () => {
      const res = await request(app)
        .post(`/api/rooms/${groupId}/icon`)
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('icon', iconPath);

      expect(res.status).toBe(403);
    });
  });
});
