/**
 * Guest user restrictions integration test (#282 Phase C)
 *
 * guest role の access control を route 層で検証:
 * - POST /api/rooms (group create) → 403
 * - POST /api/rooms/direct (direct create) → 403
 * - GET /api/users (user 一覧) → 403
 * - GET /api/users/online (online 一覧) → 403
 *
 * admin / user の同 endpoint は影響なし (= 既存挙動継続)。
 */
const request = require('supertest');
const { app } = require('../../src/app');
const { getTestPool, setupTestDb, cleanTestDb, closeTestDb } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

let pool;

beforeAll(async () => {
  await setupTestDb();
  pool = getTestPool();
});

afterAll(async () => {
  await closeTestDb();
});

async function promoteToGuest(userId) {
  await pool.query("UPDATE users SET role = 'guest' WHERE id = $1", [userId]);
}

async function promoteToAdmin(userId) {
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);
}

describe('Guest restrictions (#282 Phase C)', () => {
  let guest;
  let normalUser;
  let admin;

  beforeEach(async () => {
    await cleanTestDb();
    guest = await createTestUser({ login_id: 'GST001', display_name: 'ゲスト太郎' });
    await promoteToGuest(guest.user.id);
    guest.user.role = 'guest';

    normalUser = await createTestUser({ login_id: 'USR001', display_name: '一般ユーザー' });
    // normalUser.user.role is already 'user' via createTestUser helper

    admin = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await promoteToAdmin(admin.user.id);
    admin.user.role = 'admin';
  });

  describe('POST /api/rooms (group create)', () => {
    test('guest は 403 (room 作成不可)', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ name: 'テストグループ', member_ids: [normalUser.user.id] });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/ゲスト|guest|権限/i);
    });

    test('normal user は room 作成可 (既存挙動)', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ name: 'テストグループ', member_ids: [admin.user.id] });
      expect(res.status).toBe(201);
      expect(res.body.room.name).toBe('テストグループ');
    });

    test('admin は room 作成可 (既存挙動)', async () => {
      const res = await request(app)
        .post('/api/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'admin グループ', member_ids: [normalUser.user.id] });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /api/rooms/direct (direct create)', () => {
    test('guest は 403 (direct 作成不可)', async () => {
      const res = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ partner_id: normalUser.user.id });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/ゲスト|guest|権限/i);
    });

    test('normal user は direct 作成可 (既存挙動)', async () => {
      const res = await request(app)
        .post('/api/rooms/direct')
        .set('Authorization', `Bearer ${normalUser.token}`)
        .send({ partner_id: admin.user.id });
      expect([200, 201]).toContain(res.status);
    });
  });

  describe('GET /api/users (user 一覧)', () => {
    test('guest は 403 (他 user 情報を見ない)', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${guest.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/ゲスト|guest|権限/i);
    });

    test('normal user は user 一覧取得可 (既存挙動)', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${normalUser.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    test('admin は user 一覧取得可 (既存挙動)', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/users/online (online user 一覧)', () => {
    test('guest は 403 (他 user の online 状態を見ない)', async () => {
      const res = await request(app)
        .get('/api/users/online')
        .set('Authorization', `Bearer ${guest.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/ゲスト|guest|権限/i);
    });

    test('normal user は online 一覧取得可 (既存挙動)', async () => {
      const res = await request(app)
        .get('/api/users/online')
        .set('Authorization', `Bearer ${normalUser.token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('既存 admin endpoint (= /api/auth/me 等) は guest でも自分の情報取得可 (= breaking change なし)', () => {
    test('guest が GET /api/auth/me で自分の情報取得可', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${guest.token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(guest.user.id);
      expect(res.body.user.role).toBe('guest');
    });
  });
});
