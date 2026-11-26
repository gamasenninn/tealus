/**
 * タスク一覧 (docs/16、#661)。一覧は人のもの・部屋は括り・済みにするのは人 (AI は印まで)
 * ★ 本人の口 /api/tasks と、AI の口 /api/bot/tasks (誰の一覧かは X-Tealus-Requester で決める)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type T = Awaited<ReturnType<typeof createTestUser>>;
const H = 'X-Tealus-Requester';

describe('タスク一覧 (docs/16)', () => {
  let me: T, other: T, bot: T, roomMine: string, roomOthers: string, msgMine: string, msgOthers: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const pool = getTestPool();
    me = await createTestUser({ login_id: 'EMP6611', display_name: '本人' });
    other = await createTestUser({ login_id: 'EMP6612', display_name: '別の人' });
    bot = await createTestUser({ login_id: 'BOT661', display_name: 'アシスタント' });
    await pool.query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    roomMine = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`).send({ name: '業務', member_ids: [bot.user.id] })).body.room.id;
    roomOthers = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${other.token}`).send({ name: '別の部屋', member_ids: [bot.user.id] })).body.room.id;
    msgMine = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '見積りを出す話', 'text') RETURNING id`, [roomMine, me.user.id])).rows[0].id;
    msgOthers = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '別の話', 'text') RETURNING id`, [roomOthers, other.user.id])).rows[0].id;
  });

  const as = (u: T) => ({
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${u.token}`),
    post: (url: string, body: object) => request(app).post(url).set('Authorization', `Bearer ${u.token}`).send(body),
    patch: (url: string, body: object) => request(app).patch(url).set('Authorization', `Bearer ${u.token}`).send(body),
    del: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${u.token}`),
  });
  const asBot = (requester?: string) => {
    const h = (r: request.Test) => (requester ? r.set(H, requester) : r).set('Authorization', `Bearer ${bot.token}`);
    return {
      get: (url: string) => h(request(app).get(url)),
      post: (url: string, body: object) => h(request(app).post(url)).send(body),
      patch: (url: string, body: object) => h(request(app).patch(url)).send(body),
      del: (url: string) => h(request(app).delete(url)),
    };
  };

  describe('本人の口 /api/tasks', () => {
    it('足して一覧に出る。既定の区分は「手を動かす」、部屋の名前が付く', async () => {
      const add = await as(me).post('/api/tasks', { title: '見積りを出す', room_id: roomMine, source_message_ids: [msgMine] });
      expect(add.status).toBe(201);
      expect(add.body.task).toEqual(expect.objectContaining({
        title: '見積りを出す', section: 'do', status: 'open', room_id: roomMine,
        owner_id: me.user.id, created_by: me.user.id, source_message_ids: [msgMine], ai_suggests_done: false,
      }));
      const list = await as(me).get('/api/tasks');
      expect(list.status).toBe(200);
      expect(list.body.tasks).toHaveLength(1);
      expect(list.body.tasks[0].room_name).toBe('業務');
    });

    it('他人の一覧には出ない・他人は直せない・消せない (404)', async () => {
      const id = (await as(me).post('/api/tasks', { title: '私の' })).body.task.id;
      expect((await as(other).get('/api/tasks')).body.tasks).toHaveLength(0);
      expect((await as(other).patch(`/api/tasks/${id}`, { status: 'done' })).status).toBe(404);
      expect((await as(other).del(`/api/tasks/${id}`)).status).toBe(404);
    });

    it('括りの部屋は自分が入っている部屋だけ (403)。元の投稿も自分の部屋のものだけ', async () => {
      expect((await as(me).post('/api/tasks', { title: 'x', room_id: roomOthers })).status).toBe(403);
      expect((await as(me).post('/api/tasks', { title: 'x', source_message_ids: [msgOthers] })).status).toBe(403);
    });

    it('題が無ければ 400。区分・状態は決まった値だけ', async () => {
      expect((await as(me).post('/api/tasks', { title: '  ' })).status).toBe(400);
      expect((await as(me).post('/api/tasks', { title: 'x', section: 'someday' })).status).toBe(400);
      const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
      expect((await as(me).patch(`/api/tasks/${id}`, { status: 'finished' })).status).toBe(400);
    });

    it('済みにすると時刻と人が入り、AI の印は下りる。戻すと消える', async () => {
      const pool = getTestPool();
      const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
      await pool.query('UPDATE tasks SET ai_suggests_done = true WHERE id = $1', [id]);
      const done = await as(me).patch(`/api/tasks/${id}`, { status: 'done' });
      expect(done.status).toBe(200);
      expect(done.body.task).toEqual(expect.objectContaining({ status: 'done', done_by: me.user.id, ai_suggests_done: false }));
      expect(done.body.task.done_at).toBeTruthy();
      const back = await as(me).patch(`/api/tasks/${id}`, { status: 'open' });
      expect(back.body.task).toEqual(expect.objectContaining({ status: 'open', done_by: null, done_at: null }));
    });

    it('既定の一覧は残りと保留。status=done / all で済みも', async () => {
      const a = (await as(me).post('/api/tasks', { title: 'a' })).body.task.id;
      await as(me).post('/api/tasks', { title: 'b' });
      const c = (await as(me).post('/api/tasks', { title: 'c' })).body.task.id;
      await as(me).patch(`/api/tasks/${a}`, { status: 'done' });
      await as(me).patch(`/api/tasks/${c}`, { status: 'held' });
      expect((await as(me).get('/api/tasks')).body.tasks.map((t: { title: string }) => t.title).sort()).toEqual(['b', 'c']);
      expect((await as(me).get('/api/tasks?status=done')).body.tasks.map((t: { title: string }) => t.title)).toEqual(['a']);
      expect((await as(me).get('/api/tasks?status=all')).body.tasks).toHaveLength(3);
    });

    it('並び: 部屋 (部屋なしは最後) → 区分 (決める・手を動かす・待ち・今日でなくてよい)', async () => {
      await as(me).post('/api/tasks', { title: '個人', section: 'decide' });
      await as(me).post('/api/tasks', { title: '待ち', room_id: roomMine, section: 'waiting' });
      await as(me).post('/api/tasks', { title: '決める', room_id: roomMine, section: 'decide' });
      await as(me).post('/api/tasks', { title: 'あとで', room_id: roomMine, section: 'later' });
      const titles = (await as(me).get('/api/tasks')).body.tasks.map((t: { title: string }) => t.title);
      expect(titles).toEqual(['決める', '待ち', 'あとで', '個人']);
    });

    it('部屋で絞れる', async () => {
      await as(me).post('/api/tasks', { title: '部屋の', room_id: roomMine });
      await as(me).post('/api/tasks', { title: '個人' });
      expect((await as(me).get(`/api/tasks?room_id=${roomMine}`)).body.tasks.map((t: { title: string }) => t.title)).toEqual(['部屋の']);
    });

    it('消せる', async () => {
      const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
      expect((await as(me).del(`/api/tasks/${id}`)).status).toBe(204);
      expect((await as(me).get('/api/tasks?status=all')).body.tasks).toHaveLength(0);
    });
  });

  describe('AI の口 /api/bot/tasks (誰の一覧かは頼んだ人で決める)', () => {
    it('★ 頼んだ人の印が無ければ断る (400)', async () => {
      expect((await asBot().get('/api/bot/tasks')).status).toBe(400);
      expect((await asBot().post('/api/bot/tasks', { title: 'x' })).status).toBe(400);
    });

    it('★ 機械の口座でなければ断る (403。人が印を付けて他人の一覧に書けないように)', async () => {
      const r = await request(app).post('/api/bot/tasks').set('Authorization', `Bearer ${other.token}`).set(H, me.user.id).send({ title: '他人の一覧に' });
      expect(r.status).toBe(403);
    });

    it('頼んだ人の一覧に入る (足したのは AI)。頼んだ人の部屋・投稿だけ付けられる', async () => {
      const add = await asBot(me.user.id).post('/api/bot/tasks', { title: '見積り', room_id: roomMine, section: 'decide', source_message_ids: [msgMine] });
      expect(add.status).toBe(201);
      expect(add.body.task).toEqual(expect.objectContaining({ owner_id: me.user.id, created_by: bot.user.id, section: 'decide' }));
      expect((await asBot(me.user.id).post('/api/bot/tasks', { title: 'x', room_id: roomOthers })).status).toBe(403);
      expect((await asBot(me.user.id).post('/api/bot/tasks', { title: 'x', source_message_ids: [msgOthers] })).status).toBe(403);
      const list = await asBot(me.user.id).get('/api/bot/tasks');
      expect(list.body.tasks.map((t: { title: string }) => t.title)).toEqual(['見積り']);
      expect((await asBot(other.user.id).get('/api/bot/tasks')).body.tasks).toHaveLength(0);
    });

    it('★ AI は済みにしない: status は変えられず (400)、「済んだようです」の印までは付けられる', async () => {
      const id = (await asBot(me.user.id).post('/api/bot/tasks', { title: 'x' })).body.task.id;
      expect((await asBot(me.user.id).patch(`/api/bot/tasks/${id}`, { status: 'done' })).status).toBe(400);
      const r = await asBot(me.user.id).patch(`/api/bot/tasks/${id}`, { ai_suggests_done: true, note: '13:53 に登録できたと聞いた' });
      expect(r.status).toBe(200);
      expect(r.body.task).toEqual(expect.objectContaining({ status: 'open', ai_suggests_done: true, note: '13:53 に登録できたと聞いた' }));
    });

    it('AI は消せない (一覧から黙って消えないように)。他人の一覧のものは直せない', async () => {
      const id = (await asBot(me.user.id).post('/api/bot/tasks', { title: 'x' })).body.task.id;
      expect((await asBot(me.user.id).del(`/api/bot/tasks/${id}`)).status).toBe(404);
      expect((await asBot(other.user.id).patch(`/api/bot/tasks/${id}`, { title: 'y' })).status).toBe(404);
    });
  });
});
