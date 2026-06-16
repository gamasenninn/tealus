/**
 * #282 Phase E: admin が guest role の user を作成/設定できることのロックテスト。
 *
 * Phase A (migration 022) で users.role CHECK に 'guest' を追加済み、
 * admin/users.js は role を素通しするため、サーバー側は追加実装不要。
 * 本テストは「admin UI から guest を作れる」前提が将来も壊れないことを担保する。
 */
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb, cleanTestDb, closeTestDb, getTestPool } = require('../helpers/db');
const { createTestUser } = require('../helpers/auth');

describe('Admin guest role (#282 Phase E)', () => {
  let admin;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADMIN001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  it('POST /api/admin/users で role=guest の user を作成できる', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ login_id: 'GUEST001', display_name: 'ゲスト太郎', password: '1234', role: 'guest' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('guest');
  });

  it('PUT /api/admin/users/:id で既存 user を guest に変更できる', async () => {
    const u = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
    const res = await request(app)
      .put(`/api/admin/users/${u.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'guest' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('guest');
  });

  it('作成した guest はログインできる (= is_active な実アカウント)', async () => {
    await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ login_id: 'GUEST002', display_name: 'ゲスト花子', password: 'guestpass', role: 'guest' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ login_id: 'GUEST002', password: 'guestpass' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.role).toBe('guest');
  });
});
