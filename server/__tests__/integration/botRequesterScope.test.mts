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

/**
 * ★ 書くほうも依頼した人の部屋に絞る (セキュリティチェックループの C、2026-10-26 小野さん判断)。
 *   読むほうだけ絞っていたので、読めたものを依頼した人のいない部屋へ運べた
 */
describe('bot の書き込みも依頼した人の部屋に絞る (C)', () => {
  let bot: T, u: T, v: T, roomA: string, roomB: string, msgA: string, msgB: string;
  const H = 'X-Tealus-Requester';
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex');

  beforeAll(async () => {
    await setupTestDb();
    await cleanTestDb();
    const pool = getTestPool();
    bot = await createTestUser({ login_id: 'BOTC01', display_name: 'アシスタント' });
    u = await createTestUser({ login_id: 'EMPC01', display_name: '依頼した人' });
    v = await createTestUser({ login_id: 'EMPC02', display_name: '別の人' });
    await pool.query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    roomA = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`).send({ name: '部屋A', member_ids: [bot.user.id] })).body.room.id;
    roomB = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${v.token}`).send({ name: '部屋B', member_ids: [bot.user.id] })).body.room.id;
    await pool.query("UPDATE rooms SET message_edit_policy = 'member' WHERE id IN ($1, $2)", [roomA, roomB]);
    msgA = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, 'A の便', 'text') RETURNING id`, [roomA, bot.user.id])).rows[0].id;
    msgB = (await pool.query(`INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, 'B の便', 'text') RETURNING id`, [roomB, bot.user.id])).rows[0].id;
    const tagB = (await pool.query(`INSERT INTO tags (room_id, name, is_todo) VALUES ($1, 'Bの宿題', true) RETURNING id`, [roomB])).rows[0].id;
    await pool.query('INSERT INTO message_tags (message_id, tag_id) VALUES ($1, $2)', [msgB, tagB]);
  });
  afterAll(async () => { await closeTestDb(); });

  const auth = (r: request.Test, requester?: string) => {
    r.set('Authorization', `Bearer ${bot.token}`);
    return requester ? r.set(H, requester) : r;
  };

  it('★★ 投稿: 依頼した人のいる部屋 A は通り、いない部屋 B は 403', async () => {
    expect((await auth(request(app).post('/api/bot/push'), u.user.id).send({ room_id: roomA, content: 'こんにちは' })).status).not.toBe(403);
    expect((await auth(request(app).post('/api/bot/push'), u.user.id).send({ room_id: roomB, content: 'こんにちは' })).status).toBe(403);
  });

  it('★ ヘッダが無ければ今までどおり (トリガー・% の受け渡し・LINE など)', async () => {
    expect((await auth(request(app).post('/api/bot/push')).send({ room_id: roomB, content: 'お知らせ' })).status).not.toBe(403);
  });

  it('★★ 画像・ファイル・読み上げの音も、部屋 B は 403', async () => {
    expect((await auth(request(app).post('/api/bot/push-image'), u.user.id).field('room_id', roomB).attach('image', PNG, 'a.png')).status).toBe(403);
    expect((await auth(request(app).post('/api/bot/push-file'), u.user.id).field('room_id', roomB).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(403);
    expect((await auth(request(app).post('/api/bot/tts-speak'), u.user.id).send({ room_id: roomB, text: 'x' })).status).toBe(403);
    expect((await auth(request(app).post('/api/bot/tts-audio'), u.user.id).field('room_id', roomB).attach('audio', Buffer.from('x'), 'a.mp3')).status).toBe(403);
  });

  it('★ TODO の完了も、部屋 B の便は 403', async () => {
    const res = await auth(request(app).patch(`/api/bot/messages/${msgB}/tags/${encodeURIComponent('Bの宿題')}/done`), u.user.id).send({ is_done: true });
    expect(res.status).toBe(403);
  });

  it('★★ 便の編集も、依頼した人のいない部屋は 403 (いる部屋は通る)', async () => {
    expect((await auth(request(app).put(`/api/rooms/${roomB}/messages/${msgB}`), u.user.id).send({ content: '書き換え' })).status).toBe(403);
    expect((await auth(request(app).put(`/api/rooms/${roomA}/messages/${msgA}`), u.user.id).send({ content: '直した' })).status).toBe(200);
  });
});

/**
 * ★ AI の道具 (依頼した人の印つき) からは、人を入れた部屋を作れない (セキュリティチェックループの E、2026-10-27)。
 *   仕込まれた 1 文で、ゲストや大勢を入れた部屋を作って中身を運べた。本番で機械が作った部屋 3 つはどれも印の無い道 (Claude Code の班など)
 */
describe('AI の道具から人を入れた部屋を作らない (E)', () => {
  let bot: T, u: T, v: T;
  const H = 'X-Tealus-Requester';
  beforeAll(async () => {
    await setupTestDb();
    await cleanTestDb();
    bot = await createTestUser({ login_id: 'BOTE01', display_name: 'アシスタント' });
    u = await createTestUser({ login_id: 'EMPE01', display_name: '依頼した人' });
    v = await createTestUser({ login_id: 'EMPE02', display_name: '別の人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
  });
  afterAll(async () => { await closeTestDb(); });
  const create = (member_ids: string[], requester?: string) => {
    const r = request(app).post('/api/rooms').set('Authorization', `Bearer ${bot.token}`);
    return (requester ? r.set(H, requester) : r).send({ name: '新しい部屋', member_ids });
  };

  it('★★ 印つきで人を入れようとしたら 403', async () => {
    expect((await create([u.user.id, v.user.id], u.user.id)).status).toBe(403);
  });
  it('★ 印が無ければ今までどおり (Claude Code の班などが部屋を作る道)', async () => {
    expect((await create([u.user.id])).status).toBe(201);
  });
  it('印つきでも、人を入れない部屋は作れる', async () => {
    expect((await create([], u.user.id)).status).toBe(201);
  });
});
