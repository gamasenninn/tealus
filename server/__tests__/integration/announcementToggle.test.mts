/**
 * #540 「ホーム画面にお知らせとして表示」の切り替えはシステム管理者だけ
 *
 * ★ 画面はシステム管理者にだけ出していたが (RoomSettings の isSysAdmin)、本体は部屋の管理者でも通していた。
 *   画面と本体で決まりが食い違っていた。本体もシステム管理者だけにそろえる
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('#540 お知らせの切り替えはシステム管理者だけ', () => {
  let owner: { id: string; token: string };
  let sysAdmin: { id: string; token: string };
  let roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const o = await createTestUser({ login_id: 'EMP001', display_name: '部屋を作った人' });
    const a = await createTestUser({ login_id: 'ADM001', display_name: 'システム管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.user.id]);
    owner = { id: o.user.id, token: o.token };
    sysAdmin = { id: a.user.id, token: a.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '部屋', member_ids: [sysAdmin.id] })).body.room.id;
  });

  const isAnnouncement = async () =>
    (await getTestPool().query<{ is_announcement: boolean }>('SELECT is_announcement FROM rooms WHERE id = $1', [roomId])).rows[0].is_announcement;

  it('★★ 部屋の管理者 (システム管理者でない) は 403、変わらない', async () => {
    const res = await request(app).put(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${owner.token}`).send({ is_announcement: true });
    expect(res.status).toBe(403);
    expect(await isAnnouncement()).toBe(false);
  });

  it('★ 部屋の管理者がほかの設定 (名前) を変えるのは今までどおり通る', async () => {
    const res = await request(app).put(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${owner.token}`).send({ name: '新しい名前' });
    expect(res.status).toBe(200);
  });

  it('★ システム管理者 (かつその部屋の管理者) は切り替えられる', async () => {
    const own = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${sysAdmin.token}`)
      .send({ name: '管理者の部屋', member_ids: [] })).body.room.id;
    const res = await request(app).put(`/api/rooms/${own}`).set('Authorization', `Bearer ${sysAdmin.token}`).send({ is_announcement: true });
    expect(res.status).toBe(200);
    const r = await getTestPool().query<{ is_announcement: boolean }>('SELECT is_announcement FROM rooms WHERE id = $1', [own]);
    expect(r.rows[0].is_announcement).toBe(true);
  });
});
