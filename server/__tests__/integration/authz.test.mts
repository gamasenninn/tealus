/**
 * GET /api/auth/authz — 「この人は誰か / このルームでの役割は」を返す (#458、2026-09-26)
 *
 * ★ なぜ: agent-server の設定 API (/config/*) が「ログインしているか」しか見ておらず、
 *   一般の利用者でも全ルームの設定・全体の設定を書けた。
 *   → agent-server が **利用者自身の鍵で** 本体にここを聞き、自分で判断する (利用者判断 2026-09-26)。
 * ★★ ここが返すのは **事実だけ** (役割・ルームの種類・ルームでの役割)。「設定を書いてよいか」の判断は
 *   資源の持ち主 (agent-server) がする。本体に agent-server の決まりごとを持ち込まない。
 * ★ 無効化した利用者は authenticate が止める (is_active) —— 鍵の期限 (7 日) が残っていても通らない。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { getTestPool, setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('GET /api/auth/authz', () => {
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let groupId: string;
  let dmId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'OWN001' });
    member = await createTestUser({ login_id: 'MEM001' });
    outsider = await createTestUser({ login_id: 'OUT001' });
    const g = await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'グループ', member_ids: [member.user.id] });
    groupId = g.body.room?.id ?? g.body.id;
    const d = await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${member.token}`)
      .send({ partner_id: outsider.user.id });
    dmId = d.body.room?.id ?? d.body.id;
    expect(groupId).toBeTruthy();
    expect(dmId).toBeTruthy();
  });

  const get = (u: TestUser, roomId?: string) =>
    request(app).get(`/api/auth/authz${roomId ? `?room_id=${roomId}` : ''}`).set('Authorization', `Bearer ${u.token}`);

  it('★ room_id なし → 自分の id と役割だけ (room は null)', async () => {
    const res = await get(member);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user_id: member.user.id, role: 'user', room: null });
  });

  it('★ システム管理者の役割は admin', async () => {
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [outsider.user.id]);
    const res = await get(outsider);
    expect(res.body.role).toBe('admin');
  });

  it('★ グループを作った人はそのルームで admin', async () => {
    const res = await get(owner, groupId);
    expect(res.body.room).toEqual({ id: groupId, type: 'group', member_role: 'admin' });
  });

  it('グループのメンバーは member', async () => {
    const res = await get(member, groupId);
    expect(res.body.room).toEqual({ id: groupId, type: 'group', member_role: 'member' });
  });

  it('★★ 入っていないルームは member_role が null (★ ルームの種類は返す)', async () => {
    const res = await get(outsider, groupId);
    expect(res.status).toBe(200);
    expect(res.body.room).toEqual({ id: groupId, type: 'group', member_role: null });
  });

  it('DM の当人は member (type は direct)', async () => {
    const res = await get(outsider, dmId);
    expect(res.body.room).toEqual({ id: dmId, type: 'direct', member_role: 'member' });
  });

  it('存在しないルームは room が null', async () => {
    const res = await get(member, '00000000-0000-0000-0000-000000000000');
    expect(res.body.room).toBeNull();
  });

  it('★ room_id が uuid でなければ 400 (★ DB に変な値を投げない)', async () => {
    const res = await get(member, 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('★★ 無効化した利用者は 401 (★ 鍵の期限が残っていても)', async () => {
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [member.user.id]);
    const res = await get(member, groupId);
    expect(res.status).toBe(401);
  });

  it('鍵なしは 401', async () => {
    const res = await request(app).get('/api/auth/authz');
    expect(res.status).toBe(401);
  });
});
