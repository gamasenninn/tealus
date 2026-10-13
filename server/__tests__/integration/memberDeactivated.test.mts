/**
 * 利用停止にした人の、部屋での見え方 (改善ループ 10-13 の 4.)
 *
 * ★ 以前は利用停止 (users.is_active = false) にしても、部屋のメンバー一覧・人数・メンションの候補に
 *   それまでと同じ姿で残った (接続・ログイン・通知は止まっていた)。
 * ★ 決め (2026-10-13 利用者判断): 一覧には残し「利用停止」と添える (誰がいたかは分かる)。人数には数えない。
 *   メンションの候補には出さない (選んでも届かない)。過去の既読の数は変えない (読んだ事実)。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('利用停止にした人の、部屋での見え方', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  async function setup() {
    const a = await createTestUser({ login_id: 'EMP701', display_name: '在籍' });
    const b = await createTestUser({ login_id: 'EMP702', display_name: '退職' });
    const c = await createTestUser({ login_id: 'EMP703', display_name: '在籍2' });
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: '部屋', member_ids: [b.user.id, c.user.id] })).body.room.id;
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [b.user.id]);
    return { a, b, c, roomId };
  }

  it('★ メンバー一覧には残り、is_active で利用停止が分かる', async () => {
    const { a, b, roomId } = await setup();
    const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${a.token}`);
    const byId = Object.fromEntries(res.body.members.map((m: { user_id: string; is_active: boolean }) => [m.user_id, m.is_active]));
    expect(byId[b.user.id]).toBe(false);
    expect(byId[a.user.id]).toBe(true);
  });

  it('★ 部屋の一覧の人数には数えない', async () => {
    const { a, roomId } = await setup();
    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${a.token}`);
    expect(res.body.rooms.find((r: { id: string }) => r.id === roomId).member_count).toBe(2);
  });
});
