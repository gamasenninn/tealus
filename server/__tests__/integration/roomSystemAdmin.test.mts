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

  // ★ 改善ループ 40: ループ 39 で「解除」には守りを入れたが、「退会させる」道には無かった (管理者のいない部屋が作れた)
  it('★ 最後のグループ管理者は、システム管理者でも退会させられない', async () => {
    const kick = await request(app).delete(`/api/rooms/${roomId}/members/${owner.user.id}`).set(as(sysadmin));
    expect(kick.status).toBe(400);
    const row = await getTestPool().query('SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, owner.user.id]);
    expect(row.rows.length).toBe(1);
  });

  it('★ 無効にした人は「ほかの管理者」に数えない (解除も退会させるも断る)', async () => {
    await request(app).put(`/api/rooms/${roomId}/members/${member.user.id}/role`).set(as(owner)).send({ role: 'admin' });
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [member.user.id]);
    const demote = await request(app).put(`/api/rooms/${roomId}/members/${owner.user.id}/role`).set(as(sysadmin)).send({ role: 'member' });
    expect(demote.status).toBe(400);
    const kick = await request(app).delete(`/api/rooms/${roomId}/members/${owner.user.id}`).set(as(sysadmin));
    expect(kick.status).toBe(400);
  });

  // ★ 改善ループ 41: ほかが全員無効なのに「先に他のメンバーを管理者に」と案内していた (管理者にしても数えられない)
  it('★ ほかのメンバーが全員利用停止なら、退会させてから削除するよう案内する', async () => {
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [member.user.id]);
    const leave = await request(app).delete(`/api/rooms/${roomId}/members/me`).set(as(owner));
    expect(leave.status).toBe(400);
    expect(leave.body.error).toContain('退会させてから');
  });

  // ★ #643 (2026-11-05 小野さん判断 4): 作った人が利用停止になった部屋を誰も消せなかった (本番 3 部屋)
  it('★★ システム管理者は、メンバーが残っていてもグループ部屋を消せる (メンバーでなくても)', async () => {
    const res = await request(app).delete(`/api/rooms/${roomId}`).set(as(sysadmin));
    expect(res.status).toBe(200);
    const left = await getTestPool().query('SELECT 1 FROM rooms WHERE id = $1', [roomId]);
    expect(left.rows.length).toBe(0);
  });

  it('★ 部屋の管理者でも、システム管理者でなければ、メンバーが残っている部屋は消せない', async () => {
    const res = await request(app).delete(`/api/rooms/${roomId}`).set(as(owner));
    expect(res.status).toBe(409);
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
