/**
 * /api/rooms/:id/messages/:msgId の口は、そのメッセージが URL の部屋のものであるときだけ動く (2026-09-30)
 * ★ requireMember は「URL の部屋のメンバーか」しか見ない。別の部屋のメッセージ ID を混ぜられないようにする
 * ★ 各項に「同じ部屋なら動く」を並べて置く
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('メッセージの口は、URL の部屋のメッセージだけ', () => {
  let me: { id: string; token: string };
  let roomA: string;   // 自分がメンバー
  let roomB: string;   // 自分はメンバーでない
  let msgA: string;    // A の他人の投稿
  let msgB: string;    // B の他人の投稿 (編集履歴あり)

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP301', display_name: '自分' });
    const other = await createTestUser({ login_id: 'EMP302', display_name: '他人' });
    me = { id: u.user.id, token: u.token };
    roomA = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`)
      .send({ name: 'A', member_ids: [other.user.id] })).body.room.id;
    roomB = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${other.token}`)
      .send({ name: 'B', member_ids: [] })).body.room.id;
    const pool = getTestPool();
    msgA = (await pool.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, 'Aの投稿', 'text') RETURNING id`,
      [roomA, other.user.id])).rows[0].id;
    msgB = (await pool.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '直した後', 'text') RETURNING id`,
      [roomB, other.user.id])).rows[0].id;
    for (const [id, text] of [[msgA, 'Aの前の文面'], [msgB, 'Bの前の文面']]) {
      await pool.query('INSERT INTO message_edits (message_id, version, content, edited_by) VALUES ($1, 1, $2, $3)',
        [id, text, other.user.id]);
    }
  });

  const auth = () => ({ Authorization: `Bearer ${me.token}` });

  describe('GET /:msgId/edits', () => {
    it('同じ部屋のメッセージなら編集履歴が読める', async () => {
      const res = await request(app).get(`/api/rooms/${roomA}/messages/${msgA}/edits`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.edits.map((e: { content: string }) => e.content)).toEqual(['Aの前の文面']);
    });

    it('★ 別の部屋のメッセージは 404 (前の文面を返さない)', async () => {
      const res = await request(app).get(`/api/rooms/${roomA}/messages/${msgB}/edits`).set(auth());
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Bの前の文面');
    });
  });

  describe('POST /:msgId/reactions', () => {
    const reactions = async (msgId: string) =>
      (await getTestPool().query('SELECT 1 FROM message_reactions WHERE message_id = $1', [msgId])).rows.length;

    it('同じ部屋のメッセージならリアクションが付く', async () => {
      const res = await request(app).post(`/api/rooms/${roomA}/messages/${msgA}/reactions`).set(auth()).send({ emoji: '✅' });
      expect(res.status).toBe(200);
      expect(await reactions(msgA)).toBe(1);
    });

    it('★ 別の部屋のメッセージには付かない (404)', async () => {
      const res = await request(app).post(`/api/rooms/${roomA}/messages/${msgB}/reactions`).set(auth()).send({ emoji: '✅' });
      expect(res.status).toBe(404);
      expect(await reactions(msgB)).toBe(0);
    });
  });

  describe('DELETE /:msgId', () => {
    let mine: string;
    let roomCId: string;
    beforeEach(async () => {
      // 自分の投稿を、自分がメンバーの別の部屋 C に置く
      const roomC = (await request(app).post('/api/rooms').set(auth()).send({ name: 'C', member_ids: [] })).body.room.id;
      mine = (await getTestPool().query<{ id: string }>(
        `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '自分の投稿', 'text') RETURNING id`,
        [roomC, me.id])).rows[0].id;
      roomCId = roomC;
    });
    const deleted = async (id: string) =>
      (await getTestPool().query<{ is_deleted: boolean }>('SELECT is_deleted FROM messages WHERE id = $1', [id])).rows[0].is_deleted;

    it('同じ部屋の URL なら消せる', async () => {
      const res = await request(app).delete(`/api/rooms/${roomCId}/messages/${mine}`).set(auth());
      expect(res.status).toBe(200);
      expect(await deleted(mine)).toBe(true);
    });

    it('★ 別の部屋の URL では消さない (404)', async () => {
      const res = await request(app).delete(`/api/rooms/${roomA}/messages/${mine}`).set(auth());
      expect(res.status).toBe(404);
      expect(await deleted(mine)).toBe(false);
    });
  });
});
