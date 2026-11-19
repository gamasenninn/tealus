/**
 * 管理画面「AIの班」の口 GET /api/admin/courier (2026-11-20 利用者判断「A でつくって」、docs/12 §7)
 *
 * ★ 配達役が送る鼓動 (name = courier) をそのまま返す。班ごとの状態・新着の数・いつから・最後の鼓動・problem
 * ★ 見られるのはシステム管理者だけ (班の様子は社員全員に見せるものではない)
 * ★ 配達役が複数の機械にいれば複数行 (送った人ごと)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('GET /api/admin/courier', () => {
  let admin: Awaited<ReturnType<typeof createTestUser>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let courier: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    admin = await createTestUser({ login_id: 'ADMIN001', display_name: '管理者' });
    user = await createTestUser({ login_id: 'EMP001', display_name: '一般' });
    courier = await createTestUser({ login_id: 'courier', display_name: '配達役' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
  });

  const beat = (token: string, name: string, info: object) =>
    request(app).post('/api/bot/heartbeat').set('Authorization', `Bearer ${token}`).send({ name, info });

  it('配達役の鼓動を、送った人の名前と最後の時刻つきで返す', async () => {
    const info = { bridges: { lp: { state: 'idle', pending: 0, since: '2026-11-20T00:00:00.000Z' } }, problem: 'lp が確認待ちのまま 12 分 (新着 1 件)' };
    await beat(courier.token, 'courier', info);
    await beat(courier.token, 'radio-sender', { x: 1 });   // 配達役でない鼓動は返さない
    const res = await request(app).get('/api/admin/courier').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.couriers).toHaveLength(1);
    const c = res.body.couriers[0];
    expect(c.display_name).toBe('配達役');
    expect(c.info).toEqual(info);
    expect(typeof c.last_seen).toBe('string');
  });

  it('鼓動がまだ無ければ空の一覧', async () => {
    const res = await request(app).get('/api/admin/courier').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.couriers).toEqual([]);
  });

  it('★ システム管理者でなければ見られない', async () => {
    const res = await request(app).get('/api/admin/courier').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });
});
