import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

// Ensure test fixture
const fixturesDir = path.join(import.meta.dirname, '../fixtures');

async function ensureAvatar() {
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }
  const avatarPath = path.join(fixturesDir, 'avatar.png');
  if (!fs.existsSync(avatarPath)) {
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 128, b: 255 } }
    }).png().toFile(avatarPath);
  }
  return avatarPath;
}

describe('Profile API', () => {
  let user1: Awaited<ReturnType<typeof createTestUser>>;
  let avatarPath: string;

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

    // ★ #498 入力を確かめる。それまで空・空白だけの名前が通り、長すぎると案内の無い 500 だった
    describe('入力の確かめ (#498)', () => {
      const put = (body: unknown) => request(app).put('/api/auth/profile')
        .set('Authorization', `Bearer ${user1.token}`).send(body as object);

      it.each([
        ['空', ''],
        ['空白だけ', '   '],
        ['51 字', 'あ'.repeat(51)],
        ['数値', 123],
      ])('★ 表示名が %s なら 400 で理由を返す (名前は変わらない)', async (_l, v) => {
        const res = await put({ display_name: v });
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
        const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${user1.token}`);
        expect(me.body.user.display_name).toBe('田中太郎');
      });

      it('★ 表示名の前後の空白は落とす', async () => {
        const res = await put({ display_name: '  鈴木一郎  ' });
        expect(res.status).toBe(200);
        expect(res.body.user.display_name).toBe('鈴木一郎');
      });

      it('50 字ちょうどは通る', async () => {
        const res = await put({ display_name: 'あ'.repeat(50) });
        expect(res.status).toBe(200);
      });

      it('★ ひとことが 101 字なら 400 (500 にしない)', async () => {
        const res = await put({ status_message: 'い'.repeat(101) });
        expect(res.status).toBe(400);
        expect(typeof res.body.error).toBe('string');
      });

      it('ひとことが文字列でなければ 400', async () => {
        const res = await put({ status_message: { x: 1 } });
        expect(res.status).toBe(400);
      });
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
