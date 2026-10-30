/**
 * 初回ログインでパスワードの変更を求める・パスワードは 8 文字以上 (2026-10-29 小野さん判断 7、docs/02 users)
 *
 * ★ 管理者が決めた仮パスワードのまま使い続けられ、1 文字のパスワードも通った
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('パスワードの決まり', () => {
  let admin: TestUser;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  const create = (body: Record<string, unknown>) => request(app).post('/api/admin/users')
    .set('Authorization', `Bearer ${admin.token}`).send({ display_name: '新人', ...body });

  it('★★ 管理者が作った人は、ログインすると「変更が要る」と出る。本人が変えると消える', async () => {
    expect((await create({ login_id: 'NEW001', password: 'temp-pass1' })).status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ login_id: 'NEW001', password: 'temp-pass1' });
    expect(login.body.user.must_change_password).toBe(true);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.body.user.must_change_password).toBe(true);
    const change = await request(app).put('/api/auth/password').set('Authorization', `Bearer ${login.body.token}`)
      .send({ current_password: 'temp-pass1', new_password: 'my-own-pass' });
    expect(change.status).toBe(200);
    const me2 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me2.body.user.must_change_password).toBe(false);
  });

  it('★ 機械 (AIエージェント) には立てない', async () => {
    const res = await create({ login_id: 'BOT009', password: 'bot-pass-1', is_bot: true });
    expect(res.body.user.must_change_password).toBe(false);
  });

  it('★ 管理者がパスワードを入れ直したら、また変更を求める', async () => {
    const u = await createTestUser({ login_id: 'EMP010', display_name: '社員' });
    await request(app).put(`/api/admin/users/${u.user.id}`).set('Authorization', `Bearer ${admin.token}`).send({ password: 'reset-pass1' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.body.user.must_change_password).toBe(true);
  });

  it('★ プロフィール・アバターの保存の応答にも must_change_password が入る (画面は応答の user で置き換えるので、無いと変更の画面が消える)', async () => {
    await create({ login_id: 'NEW003', password: 'temp-pass1' });
    const login = await request(app).post('/api/auth/login').send({ login_id: 'NEW003', password: 'temp-pass1' });
    const res = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${login.body.token}`)
      .send({ notification_sound: false });
    expect(res.status).toBe(200);
    expect(res.body.user.must_change_password).toBe(true);
  });

  it('★ 管理者が自分のパスワードを管理画面で入れ直しても、自分には変更を求めない', async () => {
    await request(app).put(`/api/admin/users/${admin.user.id}`).set('Authorization', `Bearer ${admin.token}`).send({ password: 'my-new-pass1' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin.token}`);
    expect(me.body.user.must_change_password).toBe(false);
  });

  it('★★ 8 文字未満は 400 (作る・入れ直す・本人が変える)', async () => {
    expect((await create({ login_id: 'NEW002', password: '1234567' })).status).toBe(400);
    const u = await createTestUser({ login_id: 'EMP011', display_name: '社員' });
    expect((await request(app).put(`/api/admin/users/${u.user.id}`).set('Authorization', `Bearer ${admin.token}`).send({ password: 'short' })).status).toBe(400);
    expect((await request(app).put('/api/auth/password').set('Authorization', `Bearer ${u.token}`)
      .send({ current_password: 'password123', new_password: 'short' })).status).toBe(400);
  });
});
