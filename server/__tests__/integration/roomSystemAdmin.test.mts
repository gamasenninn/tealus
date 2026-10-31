/**
 * システム管理者は、どのグループ部屋でも部屋の管理者と同じ操作ができる (2026-10-31 小野さん判断 5)
 * ★ グループ部屋 37 のうち 27 部屋は部屋の管理者が 1 人だけで、その人がいないと誰も変えられなかった
 * ★ 中身を読む口は今までどおりメンバーだけ (docs/02 room_members)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('システム管理者と部屋の管理者の口', () => {
  let owner: TestUser, member: TestUser, sysadmin: TestUser, outsider: TestUser;
  let roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'EMP001', display_name: '部屋の管理者' });
    member = await createTestUser({ login_id: 'EMP002', display_name: 'メンバー' });
    sysadmin = await createTestUser({ login_id: 'EMP003', display_name: 'システム管理者' });
    outsider = await createTestUser({ login_id: 'EMP004', display_name: '外の人' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [sysadmin.user.id]);
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '部屋', member_ids: [member.user.id] })).body.room.id;
  });

  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

  it('★★ メンバーでないシステム管理者が、部屋の名前を変えられる', async () => {
    const res = await request(app).put(`/api/rooms/${roomId}`).set(as(sysadmin)).send({ name: '新しい名前' });
    expect(res.status).toBe(200);
  });

  it('★★ メンバーでないシステム管理者が、自分をメンバーに足せる (足したあとは中身を読める)', async () => {
    const add = await request(app).post(`/api/rooms/${roomId}/members`).set(as(sysadmin)).send({ user_id: sysadmin.user.id });
    expect(add.status).toBe(200);
    const msgs = await request(app).get(`/api/rooms/${roomId}/messages`).set(as(sysadmin));
    expect(msgs.status).toBe(200);
  });

  it('★★ メンバーでないシステム管理者が、メンバーを外せる・管理者にできる', async () => {
    const role = await request(app).put(`/api/rooms/${roomId}/members/${member.user.id}/role`).set(as(sysadmin)).send({ role: 'admin' });
    expect(role.status).toBe(200);
    const kick = await request(app).delete(`/api/rooms/${roomId}/members/${member.user.id}`).set(as(sysadmin));
    expect(kick.status).toBe(200);
  });

  it('★★ メンバーでないシステム管理者でも、中身 (投稿・部屋の詳細) は読めない', async () => {
    expect((await request(app).get(`/api/rooms/${roomId}/messages`).set(as(sysadmin))).status).toBe(403);
    expect((await request(app).get(`/api/rooms/${roomId}`).set(as(sysadmin))).status).toBe(403);
  });

  it('★ メンバーのシステム管理者も、部屋の管理者でなくても名前を変えられる', async () => {
    await getTestPool().query("INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'member')", [roomId, sysadmin.user.id]);
    const res = await request(app).put(`/api/rooms/${roomId}`).set(as(sysadmin)).send({ name: '新しい名前' });
    expect(res.status).toBe(200);
  });

  it('一般のメンバーは今までどおり変えられない・外の人は今までどおり 403', async () => {
    expect((await request(app).put(`/api/rooms/${roomId}`).set(as(member)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).put(`/api/rooms/${roomId}`).set(as(outsider)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post(`/api/rooms/${roomId}/members`).set(as(outsider)).send({ user_id: outsider.user.id })).status).toBe(403);
  });

  it('1 対 1 の部屋は対象外 (メンバーでないシステム管理者は 403)', async () => {
    const direct = (await request(app).post('/api/rooms/direct').set(as(owner)).send({ partner_id: member.user.id })).body.room.id;
    expect((await request(app).delete(`/api/rooms/${direct}/members/${member.user.id}`).set(as(sysadmin))).status).toBe(403);
  });
});
