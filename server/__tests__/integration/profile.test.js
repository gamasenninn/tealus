const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

// Ensure test fixture
const fixturesDir = path.join(__dirname, '../fixtures');

async function ensureAvatar() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const avatarPath = path.join(fixturesDir, 'avatar.png');
  if (!fs.existsSync(avatarPath)) {
    const sharp = require('sharp');
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 128, b: 255 } }
    }).png().toFile(avatarPath);
  }
  return avatarPath;
}

describe('Profile API', () => {
  let user1, avatarPath;

  beforeAll(async () => {
    await setupTestDb();
    avatarPath = await ensureAvatar();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    user1 = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎', password: 'password123' });
  });

  // ============================================
  // PUT /api/auth/profile
  // ============================================
  describe('PUT /api/auth/profile', () => {
    it('should update display_name', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ display_name: '田中次郎' });

      expect(res.status).toBe(200);
      expect(res.body.user.display_name).toBe('田中次郎');
    });

    it('should update status_message', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ status_message: 'お疲れ様です' });

      expect(res.status).toBe(200);
      expect(res.body.user.status_message).toBe('お疲れ様です');
    });

    it('should update both at once', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ display_name: '新しい名前', status_message: 'よろしく' });

      expect(res.status).toBe(200);
      expect(res.body.user.display_name).toBe('新しい名前');
      expect(res.body.user.status_message).toBe('よろしく');
    });

    it('should clear status_message with empty string', async () => {
      // Set first
      await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ status_message: 'テスト' });

      // Clear
      const res = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ status_message: '' });

      expect(res.status).toBe(200);
      expect(res.body.user.status_message).toBe('');
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .put('/api/auth/profile')
        .send({ display_name: 'test' });

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // POST /api/auth/avatar
  // ============================================
  describe('POST /api/auth/avatar', () => {
    it('should upload avatar image', async () => {
      const res = await request(app)
        .post('/api/auth/avatar')
        .set('Authorization', `Bearer ${user1.token}`)
        .attach('avatar', avatarPath);

      expect(res.status).toBe(200);
      expect(res.body.user.avatar_url).toBeDefined();
      expect(res.body.user.avatar_url).toContain('avatars/');
    });

    it('should reject without file', async () => {
      const res = await request(app)
        .post('/api/auth/avatar')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/auth/avatar');

      expect(res.status).toBe(401);
    });
  });

  // ============================================
  // PUT /api/auth/password
  // ============================================
  describe('PUT /api/auth/password', () => {
    it('should change password with correct current password', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ current_password: 'password123', new_password: 'newpass456' });

      expect(res.status).toBe(200);

      // Verify new password works
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ login_id: 'EMP001', password: 'newpass456' });
      expect(loginRes.status).toBe(200);
    });

    it('should reject with wrong current password', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ current_password: 'wrongpass', new_password: 'newpass456' });

      expect(res.status).toBe(401);
    });

    it('should reject without required fields', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ new_password: 'newpass456' });

      expect(res.status).toBe(400);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .put('/api/auth/password')
        .send({ current_password: 'password123', new_password: 'newpass456' });

      expect(res.status).toBe(401);
    });
  });
});
