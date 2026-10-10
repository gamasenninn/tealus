/**
 * #564 AI が読める部屋を「頼んだ人が入っている部屋」に絞る (bot の呼び出しに X-Tealus-Requester が付いたとき)。
 * ★ 以前は bot が入っている部屋ならどれでも読めた (AI の道具は bot の資格で呼ぶので、本体から誰の依頼かが見えなかった)
 * ★ ヘッダが無ければ今までどおり (cc ブリッジ・LINE などの bot)。ヘッダは絞る方向にしか効かない
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type T = Awaited<ReturnType<typeof createTestUser>>;

describe('bot の読み取りを依頼した人の部屋に絞る (#564)', () => {
  let bot: T, u: T, v: T, roomA: string, roomB: string, msgA: string, msgB: string;
  const H = 'X-Tealus-Requester';

  beforeAll(async () => {
    await setupTestDb();
    await cleanTestDb();
    const pool = getTestPool();
    bot = await createTestUser({ login_id: 'BOT564', display_name: 'アシスタント' });
    u = await createTestUser({ login_id: 'EMP5641', display_name: '依頼した人' });
    v = await createTestUser({ login_id: 'EMP5642', display_name: '別の人' });
    await pool.query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    roomA = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`).send({ name: '部屋A', member_ids: [bot.user.id] })).body.room.id;
    roomB = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${v.token}`).send({ name: '部屋B', member_ids: [bot.user.id] })).body.room.id;
    msgA = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '合言葉 りんご A', 'text') RETURNING id`, [roomA, u.user.id])).rows[0].id;
    msgB = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '合言葉 りんご B', 'text') RETURNING id`, [roomB, v.user.id])).rows[0].id;
    const tagB = (await pool.query(`INSERT INTO tags (room_id, name) VALUES ($1, '部屋Bのタグ') RETURNING id`, [roomB])).rows[0].id;
    await pool.query('INSERT INTO message_tags (message_id, tag_id) VALUES ($1, $2)', [msgB, tagB]);
  });
  afterAll(async () => { await closeTestDb(); });

  const asBot = (method: 'get' | 'post', url: string, requester?: string) => {
    const r = request(app)[method](url).set('Authorization', `Bearer ${bot.token}`);
    return requester ? r.set(H, requester) : r;
  };

  it('ヘッダが無ければ今までどおり (部屋 B も読める)', async () => {
    const res = await asBot('get', `/api/bot/messages?room_id=${roomB}`);
    expect(res.status).toBe(200);
  });

  it('★ 部屋の投稿: 依頼した人が入っている部屋 A は読め、入っていない部屋 B は 403', async () => {
    expect((await asBot('get', `/api/bot/messages?room_id=${roomA}`, u.user.id)).status).toBe(200);
    expect((await asBot('get', `/api/bot/messages?room_id=${roomB}`, u.user.id)).status).toBe(403);
  });

  it('★ 投稿の ID で読む口 (添付・編集の履歴・文字起こし) も部屋 B は 403', async () => {
    expect((await asBot('get', `/api/bot/messages/${msgB}/media`, u.user.id)).status).toBe(403);
    expect((await asBot('get', `/api/bot/messages/${msgB}/edit-history`, u.user.id)).status).toBe(403);
    expect((await asBot('post', `/api/bot/messages/${msgB}/transcribe`, u.user.id)).status).toBe(403);
    expect((await asBot('get', `/api/bot/messages/${msgA}/edit-history`, u.user.id)).status).not.toBe(403);
  });

  it('★ 検索: 部屋の指定が無ければ、依頼した人の部屋だけから探す', async () => {
    const res = await asBot('get', `/api/bot/search?q=${encodeURIComponent('合言葉 りんご')}`, u.user.id);
    expect(res.status).toBe(200);
    const rooms = res.body.results.map((r: { room_id: string }) => r.room_id);
    expect(rooms).toContain(roomA);
    expect(rooms).not.toContain(roomB);
  });

  it('★ 部屋の一覧・未読・タグ・参加の確認も、依頼した人の部屋だけ', async () => {
    const rooms = (await asBot('get', '/api/bot/rooms', u.user.id)).body.rooms.map((r: { id: string }) => r.id);
    expect(rooms).toEqual([roomA]);
    const unread = (await asBot('get', '/api/bot/unread', u.user.id)).body;
    expect(JSON.stringify(unread)).not.toContain(roomB);
    const tags = (await asBot('get', '/api/bot/tags', u.user.id)).body.tags.map((t: { name: string }) => t.name);
    expect(tags).not.toContain('部屋Bのタグ');
    expect((await asBot('get', `/api/bot/rooms/${roomB}/membership?user_id=${v.user.id}`, u.user.id)).status).toBe(403);
  });

  it('ヘッダの値が ID の形でなければ 400 (黙って広げない)', async () => {
    expect((await asBot('get', `/api/bot/messages?room_id=${roomA}`, 'not-a-uuid')).status).toBe(400);
  });
});
