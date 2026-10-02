/**
 * 部屋づくりで指定する人を確かめる (2026-10-02、利用者判断)
 *
 * ★ 人を部屋に追加する口 (routes/members.mts) は「存在して有効な人 (is_active)」だけを受けていたが、
 *   部屋づくりの 2 つの口は確かめていなかった:
 *   - グループ (member_ids): 存在しない ID・重複で 500、無効にした人も入れられた
 *   - 1 対 1 (partner_id): 存在しない ID で 500、無効にした人とも作れた。自分自身を指定すると手持ちの 1 対 1 のどれかが返った
 * ★ ゲストを部屋に入れること自体は members.mts も許している (止めているのはゲストが招くこと) ので、ここでも変えない
 */
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app } from '../../src/app.mts';

describe('部屋づくりで指定する人', () => {
  let me: { id: string; token: string };
  let active: string; let inactive: string; let bot: string;
  const NONE = '00000000-0000-4000-8000-000000000000';
  const auth = () => ({ Authorization: `Bearer ${me.token}` });
  const roomCount = async () => (await getTestPool().query<{ n: number }>('SELECT count(*)::int n FROM rooms')).rows[0].n;

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await cleanTestDb();
    const m = await createTestUser({ login_id: 'EMP891', display_name: '作る人' });
    me = { id: m.user.id, token: m.token };
    active = (await createTestUser({ login_id: 'EMP892', display_name: '有効な人' })).user.id;
    inactive = (await createTestUser({ login_id: 'EMP893', display_name: '無効にした人' })).user.id;
    bot = (await createTestUser({ login_id: 'BOT891', display_name: 'ボット' })).user.id;
    await getTestPool().query('UPDATE users SET is_active = false WHERE id = $1', [inactive]);
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot]);
  });
  afterAll(async () => { await closeTestDb(); });

  describe('グループ (POST /api/rooms)', () => {
    const create = (member_ids: unknown) => request(app).post('/api/rooms').set(auth()).send({ name: 'g', member_ids });
    it('有効な人とボットは入れられる', async () => {
      const res = await create([active, bot]);
      expect(res.status).toBe(201);
      expect(res.body.members.map((x: { user_id: string }) => x.user_id).sort()).toEqual([me.id, active, bot].sort());
    });
    it('★ 同じ人を重ねて書いても 1 人にまとめる (500 にしない)。自分を書いても重ならない', async () => {
      const res = await create([active, active, me.id]);
      expect(res.status).toBe(201);
      expect(res.body.members).toHaveLength(2);
    });
    it.each([
      ['存在しない人', () => [active, NONE]],
      ['無効にした人', () => [inactive]],
    ])('★ %s を含むと 400 で、部屋を作らない', async (_l, ids) => {
      const before = await roomCount();
      const res = await create(ids());
      expect(res.status).toBe(400);
      expect(await roomCount()).toBe(before);
    });
    it('★ ID の形でないものは 400', async () => {
      expect((await create(['x'])).status).toBe(400);
    });
  });

  describe('1 対 1 (POST /api/rooms/direct)', () => {
    const direct = (partner_id: unknown) => request(app).post('/api/rooms/direct').set(auth()).send({ partner_id });
    it('有効な人・ボットとは作れる', async () => {
      expect((await direct(active)).status).toBe(201);
      expect((await direct(bot)).status).toBe(201);
    });
    it('★ 自分自身は 400 (手持ちの 1 対 1 を返さない)', async () => {
      const res = await direct(me.id);
      expect(res.status).toBe(400);
      expect(res.body.room).toBeUndefined();
    });
    it.each([
      ['存在しない人', NONE],
      ['無効にした人', () => inactive],
    ])('★ %s とは作らない (404)', async (_l, id) => {
      const before = await roomCount();
      const res = await direct(typeof id === 'function' ? id() : id);
      expect(res.status).toBe(404);
      expect(await roomCount()).toBe(before);
    });
    it('★ ID の形でないものは 400', async () => {
      expect((await direct('x')).status).toBe(400);
    });
  });
});
