/**
 * 部屋のアプリ (app_urls) とホームのリンク (portal_links) は http / https だけを受け付ける
 * (セキュリティチェックループ 2 回目、2026-10-26)。★ 画面の入力欄は URL の形を見るだけで、本体は何でも保存していた
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('app_urls / portal_links の URL の種類', () => {
  let owner: TestUser, sysadmin: TestUser;
  let roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    sysadmin = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [sysadmin.user.id]);
    const res = await request(app).post('/api/rooms')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '棚卸', member_ids: [] });
    roomId = res.body.room.id;
  });

  const put = (apps: unknown) => request(app).put(`/api/rooms/${roomId}`)
    .set('Authorization', `Bearer ${owner.token}`).send({ app_urls: apps });

  it('★ http / https は今までどおり保存できる', async () => {
    const res = await put([{ title: 'A', url: 'https://apps.example.com/x' }, { title: 'B', url: 'http://10.0.0.1/y' }]);
    expect(res.status).toBe(200);
  });

  it('★★ http / https 以外の URL は 400 で、保存しない', async () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:void(0)', 'data:text/html,x', 'file:///c:/x', 'not a url', '']) {
      const res = await put([{ title: 'A', url }]);
      expect(res.status).toBe(400);
    }
    const row = await getTestPool().query('SELECT app_urls FROM rooms WHERE id = $1', [roomId]);
    expect(JSON.stringify(row.rows[0].app_urls ?? [])).not.toMatch(/javascript|data:|file:/i);
  });

  it('★ 配列でない・URL の無い要素は 400', async () => {
    expect((await put('https://x.example.com')).status).toBe(400);
    expect((await put([{ title: 'A' }])).status).toBe(400);
  });

  it('★ 見出し・比率・切り替えの型が違うものは 400 (画面が落ちる値を保存しない)', async () => {
    expect((await put([{ title: { a: 1 }, url: 'https://x.example.com' }])).status).toBe(400);
    expect((await put([{ title: 'A', url: 'https://x.example.com', ratio: '50' }])).status).toBe(400);
    expect((await put([{ title: 'A', url: 'https://x.example.com', pass: 'yes' }])).status).toBe(400);
    expect((await put([{ title: 'A', url: 'https://x.example.com', ratio: 40, pass: true, auto_open: false, wake_lock: true }])).status).toBe(200);
  });

  it('★ 空の配列 (全部消す) は通る', async () => {
    expect((await put([])).status).toBe(200);
  });

  it('★★ ホームのリンクも http / https だけ (作る・直す)', async () => {
    const bad = await request(app).post('/api/admin/portal-links')
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ title: 'X', url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/admin/portal-links')
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ title: 'X', url: 'https://portal.example.com/' });
    expect(ok.status).toBe(201);
    const upd = await request(app).put(`/api/admin/portal-links/${ok.body.link.id}`)
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ url: 'data:text/html,x' });
    expect(upd.status).toBe(400);
  });
});

describe('webhook の宛先と応答の見出し (セキュリティチェックループ 3 回目)', () => {
  let sysadmin: TestUser;
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    sysadmin = await createTestUser({ login_id: 'ADM002', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [sysadmin.user.id]);
  });

  it('★ webhook の宛先も http / https だけ (登録・直す)', async () => {
    const bad = await request(app).post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ url: 'file:///c:/x' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/admin/webhooks')
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ url: 'http://localhost:4000/webhook' });
    expect(ok.status).toBe(201);
    const upd = await request(app).put(`/api/admin/webhooks/${ok.body.webhook.id}`)
      .set('Authorization', `Bearer ${sysadmin.token}`).send({ url: 'gopher://x' });
    expect(upd.status).toBe(400);
  });

  it('★ 応答に X-Powered-By を出さず、nosniff を付ける', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
