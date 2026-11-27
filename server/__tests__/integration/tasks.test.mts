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

    it('既定の一覧は残り (区分が保留のものも)。status=done / all で済みも', async () => {
      const a = (await as(me).post('/api/tasks', { title: 'a' })).body.task.id;
      await as(me).post('/api/tasks', { title: 'b' });
      const c = (await as(me).post('/api/tasks', { title: 'c' })).body.task.id;
      await as(me).patch(`/api/tasks/${a}`, { status: 'done' });
      await as(me).patch(`/api/tasks/${c}`, { section: 'held' });
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

    /** docs/16 §8-7 (11-28): 保留は区分の 5 つ目。状態の held はやめた */
    describe('★ 保留 (区分 held)', () => {
      it('★★ 区分を保留にすると、いつ保留にしたかが入る。ほかの区分へ戻すと消える', async () => {
        const id = (await as(me).post('/api/tasks', { title: 'あとで考える', section: 'decide' })).body.task.id;
        const h = await as(me).patch(`/api/tasks/${id}`, { section: 'held' });
        expect(h.status).toBe(200);
        expect(h.body.task.section).toBe('held');
        expect(h.body.task.status).toBe('open');
        expect(h.body.task.held_at).toBeTruthy();
        const again = await as(me).patch(`/api/tasks/${id}`, { title: '題だけ直す' });
        expect(again.body.task.held_at).toBe(h.body.task.held_at);   // ★ 保留のまま直しても、いつからは変わらない
        const back = await as(me).patch(`/api/tasks/${id}`, { section: 'decide' });
        expect(back.body.task.held_at).toBeNull();
      });

      it('★ 手で足すときから保留にもできる (いつからが入る)', async () => {
        const t = (await as(me).post('/api/tasks', { title: '保留で足す', section: 'held' })).body.task;
        expect(t.section).toBe('held');
        expect(t.held_at).toBeTruthy();
      });

      it('★ 並びは部屋の中のいちばん最後 (今日でなくてよい の後)', async () => {
        await as(me).post('/api/tasks', { title: '保留', room_id: roomMine, section: 'held' });
        await as(me).post('/api/tasks', { title: 'あとで', room_id: roomMine, section: 'later' });
        await as(me).post('/api/tasks', { title: '決める', room_id: roomMine, section: 'decide' });
        const titles = (await as(me).get('/api/tasks')).body.tasks.map((t: { title: string }) => t.title);
        expect(titles).toEqual(['決める', 'あとで', '保留']);
      });

      it('★ status=held は区分が保留の残りで絞る (前の版の道具が使う絞りのまま)', async () => {
        await as(me).post('/api/tasks', { title: 'ふつう' });
        await as(me).post('/api/tasks', { title: '保留', section: 'held' });
        const d = (await as(me).post('/api/tasks', { title: '保留で済み', section: 'held' })).body.task.id;
        await as(me).patch(`/api/tasks/${d}`, { status: 'done' });
        expect((await as(me).get('/api/tasks?status=held')).body.tasks.map((t: { title: string }) => t.title)).toEqual(['保留']);
      });

      it('★ 状態を held にするのは断る (400。保留は区分で)', async () => {
        const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
        const r = await as(me).patch(`/api/tasks/${id}`, { status: 'held' });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/区分/);
      });
    });

    it('部屋で絞れる', async () => {
      await as(me).post('/api/tasks', { title: '部屋の', room_id: roomMine });
      await as(me).post('/api/tasks', { title: '個人' });
      expect((await as(me).get(`/api/tasks?room_id=${roomMine}`)).body.tasks.map((t: { title: string }) => t.title)).toEqual(['部屋の']);
    });

    it('★ 番号: 会社全体の通し番号。人が違っても重ならない。済みにしても変わらない (番号は行為の ID、11-26 利用者)', async () => {
      const a = (await as(me).post('/api/tasks', { title: 'a' })).body.task;
      const o = (await as(other).post('/api/tasks', { title: '別の人の' })).body.task;
      const b = (await as(me).post('/api/tasks', { title: 'b' })).body.task;
      expect(o.number).toBe(a.number + 1);
      expect(b.number).toBe(a.number + 2);
      await as(me).patch(`/api/tasks/${a.id}`, { status: 'done' });
      const list = (await as(me).get('/api/tasks?status=all')).body.tasks;
      expect(list.map((t: { title: string; number: number }) => [t.title, t.number])).toEqual(expect.arrayContaining([['a', a.number], ['b', b.number]]));
    });

    it('★ 消した番号は使い回さない (一番大きい番号を消しても、次は続きから)', async () => {
      const a = (await as(me).post('/api/tasks', { title: 'a' })).body.task;
      await as(me).del(`/api/tasks/${a.id}`);
      const b = (await as(me).post('/api/tasks', { title: 'b' })).body.task;
      expect(b.number).toBe(a.number + 1);
    });

    it('同時に足しても番号は重ならない', async () => {
      const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => as(i % 2 ? me : other).post('/api/tasks', { title: `p${i}` })));
      const nums = rs.map((r) => r.body.task.number);
      expect(new Set(nums).size).toBe(8);
    });

    it('番号は直せない (本人の口でも黙って無視しない: 400)', async () => {
      const id = (await as(me).post('/api/tasks', { title: 'a' })).body.task.id;
      expect((await as(me).patch(`/api/tasks/${id}`, { number: 9 })).status).toBe(400);
    });

    describe('★ タスク 33 期限 (due_date、日付だけ。docs/16 §8-6)', () => {
      it('足すときに入れられ、YYYY-MM-DD の字で返る。入れなければ null', async () => {
        const a = await as(me).post('/api/tasks', { title: 'a', due_date: '2026-11-30' });
        expect(a.status).toBe(201);
        expect(a.body.task.due_date).toBe('2026-11-30');
        expect((await as(me).post('/api/tasks', { title: 'b' })).body.task.due_date).toBeNull();
        const list = (await as(me).get('/api/tasks')).body.tasks;
        expect(list.find((t: { title: string }) => t.title === 'a').due_date).toBe('2026-11-30');
      });

      it('直せる・空 (null) に戻せる。他を直しても期限は残る', async () => {
        const id = (await as(me).post('/api/tasks', { title: 'a' })).body.task.id;
        expect((await as(me).patch(`/api/tasks/${id}`, { due_date: '2026-12-01' })).body.task.due_date).toBe('2026-12-01');
        expect((await as(me).patch(`/api/tasks/${id}`, { title: 'b' })).body.task.due_date).toBe('2026-12-01');
        expect((await as(me).patch(`/api/tasks/${id}`, { due_date: null })).body.task.due_date).toBeNull();
      });

      it('形の違う値・無い日付は 400 (足す・直すとも)', async () => {
        for (const bad of ['2026/11/30', '2026-11-31', '2026-02-29', '20261130', '2026-11-30T00:00:00Z', '', 20261130, true]) {
          expect((await as(me).post('/api/tasks', { title: 'x', due_date: bad })).status).toBe(400);
        }
        const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
        expect((await as(me).patch(`/api/tasks/${id}`, { due_date: '2026-13-01' })).status).toBe(400);
        expect((await as(me).post('/api/tasks', { title: 'うるう', due_date: '2028-02-29' })).body.task.due_date).toBe('2028-02-29');
      });

      it('★ 日付はどの時間帯で動いていても 1 日ずれない (JST・UTC・西の時間帯)', async () => {
        const saved = process.env.TZ;
        try {
          for (const tz of ['Asia/Tokyo', 'UTC', 'America/Los_Angeles']) {
            process.env.TZ = tz;
            const t = (await as(me).post('/api/tasks', { title: tz, due_date: '2026-11-30' })).body.task;
            expect(t.due_date).toBe('2026-11-30');
            expect((await as(me).patch(`/api/tasks/${t.id}`, { due_date: '2027-01-01' })).body.task.due_date).toBe('2027-01-01');
          }
        } finally {
          if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
        }
      });

      it('期限で並べ替えない (並びは今のまま)', async () => {
        await as(me).post('/api/tasks', { title: '遅い', due_date: '2026-12-31' });
        await as(me).post('/api/tasks', { title: '早い', due_date: '2026-11-01' });
        expect((await as(me).get('/api/tasks')).body.tasks.map((t: { title: string }) => t.title)).toEqual(['遅い', '早い']);
      });
    });

    it('消せる', async () => {
      const id = (await as(me).post('/api/tasks', { title: 'x' })).body.task.id;
      expect((await as(me).del(`/api/tasks/${id}`)).status).toBe(200);
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

    it('AI が足したものも同じ番号の並びに入る', async () => {
      const h = (await as(me).post('/api/tasks', { title: '手で' })).body.task;
      const t = (await asBot(me.user.id).post('/api/bot/tasks', { title: 'AI が' })).body.task;
      expect(t.number).toBe(h.number + 1);
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

    it('★ タスク 33 AI の口も期限を入れる・直す・空にできる (入れてよいときの決まりは docs/16 §4.2、口では断らない)。形が違えば 400', async () => {
      const add = await asBot(me.user.id).post('/api/bot/tasks', { title: '12-04 に数え直す', due_date: '2026-12-04', note: 'AI が決めた日' });
      expect(add.status).toBe(201);
      expect(add.body.task.due_date).toBe('2026-12-04');
      const id = add.body.task.id;
      expect((await asBot(me.user.id).patch(`/api/bot/tasks/${id}`, { due_date: '2026-12-05' })).body.task.due_date).toBe('2026-12-05');
      expect((await asBot(me.user.id).patch(`/api/bot/tasks/${id}`, { due_date: null })).body.task.due_date).toBeNull();
      expect((await asBot(me.user.id).post('/api/bot/tasks', { title: 'x', due_date: '金曜' })).status).toBe(400);
      expect((await asBot(me.user.id).get('/api/bot/tasks')).body.tasks[0]).toHaveProperty('due_date', null);
    });

    it('★★ AI は保留に入れない・出さない (保留は人の判断、docs/16 §4.2)。足すときも保留は受けない', async () => {
      const id = (await asBot(me.user.id).post('/api/bot/tasks', { title: 'x' })).body.task.id;
      const into = await asBot(me.user.id).patch(`/api/bot/tasks/${id}`, { section: 'held' });
      expect(into.status).toBe(400);
      expect(into.body.error).toMatch(/保留/);
      expect((await asBot(me.user.id).post('/api/bot/tasks', { title: 'y', section: 'held' })).status).toBe(400);
      const held = (await as(me).post('/api/tasks', { title: '本人が保留', section: 'held' })).body.task.id;
      expect((await asBot(me.user.id).patch(`/api/bot/tasks/${held}`, { section: 'do' })).status).toBe(400);
      // 保留のものでも、区分を変えない直し (ひとこと・期限) はできる
      const note = await asBot(me.user.id).patch(`/api/bot/tasks/${held}`, { note: '12-04 に見直す' });
      expect(note.status).toBe(200);
      expect(note.body.task.section).toBe('held');
    });

    it('AI は消せない (一覧から黙って消えないように)。他人の一覧のものは直せない', async () => {
      const id = (await asBot(me.user.id).post('/api/bot/tasks', { title: 'x' })).body.task.id;
      expect((await asBot(me.user.id).del(`/api/bot/tasks/${id}`)).status).toBe(404);
      expect((await asBot(other.user.id).patch(`/api/bot/tasks/${id}`, { title: 'y' })).status).toBe(404);
    });
  });
  // ★ 11-27 ブラウザの試験で、お客様 (guest) の口座でも /api/tasks を呼べた (画面はお客様に出していない)。
  //   段階 1 は社員本人の一覧だけ (docs/16 §4.1・§7)。お客様の一覧は本人の口でも AI の口でも作らない
  describe('お客様 (guest) は使えない', () => {
    let guest: T;
    beforeEach(async () => {
      guest = await createTestUser({ login_id: 'GST661', display_name: 'お客様' });
      await getTestPool().query(`UPDATE users SET role = 'guest' WHERE id = $1`, [guest.user.id]);
    });

    it('本人の口: 読む・足す・直す・消すは 403', async () => {
      expect((await as(guest).get('/api/tasks')).status).toBe(403);
      expect((await as(guest).post('/api/tasks', { title: 'x' })).status).toBe(403);
      expect((await as(guest).patch('/api/tasks/00000000-0000-0000-0000-000000000000', { title: 'y' })).status).toBe(403);
      expect((await as(guest).del('/api/tasks/00000000-0000-0000-0000-000000000000')).status).toBe(403);
      const { rows } = await getTestPool().query('SELECT count(*)::int AS n FROM tasks WHERE owner_id = $1', [guest.user.id]);
      expect(rows[0].n).toBe(0);
    });

    it('AI の口: 頼んだ人がお客様なら 403 (お客様の一覧に書かない)', async () => {
      expect((await asBot(guest.user.id).get('/api/bot/tasks')).status).toBe(403);
      expect((await asBot(guest.user.id).post('/api/bot/tasks', { title: 'x' })).status).toBe(403);
      const { rows } = await getTestPool().query('SELECT count(*)::int AS n FROM tasks WHERE owner_id = $1', [guest.user.id]);
      expect(rows[0].n).toBe(0);
    });

    it('社員の本人の口・AI の口は今までどおり', async () => {
      expect((await as(me).get('/api/tasks')).status).toBe(200);
      expect((await asBot(me.user.id).get('/api/bot/tasks')).status).toBe(200);
    });
  });
});
