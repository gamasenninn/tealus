/**
 * #483 部屋の外の投稿・タグ・通話を指す口を、その部屋のものに絞る (2026-10-02、#482 の続き)
 *
 * ★ 部屋 1 (送る人がメンバー) と 部屋 3 (送る人はメンバーでない) を作り、部屋 3 の投稿・タグを部屋 1 の口に渡す
 * ★ 部屋の外のものは「無いもの」と同じに扱う (区別して返さない)
 * ★ 10-01 の部外者の総当たり (outsiderSweep) は「部屋の側に何か起きるか」を見ていて、
 *   **問い合わせた本人に返る中身**と、**リクエストの中身に書かれた参照**は見ていなかった
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import { activeCalls } from '../../src/socket/handlers/call.mts';

describe('#483 部屋の外を指す口', () => {
  let port: number;
  let a: { id: string; token: string };
  let b: { id: string; token: string };
  let r1: string; // a と b がメンバー
  let r3: string; // b だけ
  let m1old: string; let m1new: string; let m3: string;
  let t1: string; let t3: string;
  const clients: ClientSocket[] = [];

  const connect = (token: string, rooms: string[]) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { for (const r of rooms) s.emit('room:join', r); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
    clients.push(s);
  });
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP871', display_name: '尋ねる人' });
    const ub = await createTestUser({ login_id: 'EMP872', display_name: '部屋 3 の人' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    r1 = (await request(app).post('/api/rooms').set(auth(a.token)).send({ name: '部屋 1', member_ids: [b.id] })).body.room.id;
    r3 = (await request(app).post('/api/rooms').set(auth(b.token)).send({ name: '部屋 3', member_ids: [] })).body.room.id;
    const pool = getTestPool();
    const ins = async (room: string, sender: string, content: string, at: string) => (await pool.query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, 'text', $4) RETURNING id`,
      [room, sender, content, at])).rows[0].id;
    m1old = await ins(r1, b.id, '部屋 1 の古い投稿', '2026-01-01T00:00:00Z');
    m3 = await ins(r3, b.id, '部屋 3 の投稿', '2026-02-01T00:00:00Z');
    m1new = await ins(r1, b.id, '部屋 1 の新しい投稿', '2026-03-01T00:00:00Z');
    t1 = (await pool.query<{ id: string }>(`INSERT INTO tags (room_id, name, created_by) VALUES ($1, '部屋1のタグ', $2) RETURNING id`, [r1, b.id])).rows[0].id;
    t3 = (await pool.query<{ id: string }>(`INSERT INTO tags (room_id, name, created_by) VALUES ($1, '部屋3の秘密のタグ', $2) RETURNING id`, [r3, b.id])).rows[0].id;
  });
  afterAll(async () => {
    while (clients.length) clients.pop()!.close();
    activeCalls.clear();
    appServer.close();
    await closeTestDb();
  });

  describe('タグを付ける口', () => {
    it('同じ部屋のタグは付けられる', async () => {
      const res = await request(app).post(`/api/messages/${m1new}/tags`).set(auth(a.token)).send({ tag_id: t1 });
      expect(res.status).toBe(201);
      expect(res.body.tag.id).toBe(t1);
    });
    it('★ 別の部屋のタグは断り、中身を返さず、付かない', async () => {
      const res = await request(app).post(`/api/messages/${m1new}/tags`).set(auth(a.token)).send({ tag_id: t3 });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('秘密');
      const linked = await getTestPool().query('SELECT 1 FROM message_tags WHERE message_id = $1 AND tag_id = $2', [m1new, t3]);
      expect(linked.rowCount).toBe(0);
    });
    it('★ 無いタグも同じ答え', async () => {
      const none = await request(app).post(`/api/messages/${m1new}/tags`).set(auth(a.token)).send({ tag_id: '00000000-0000-4000-8000-000000000000' });
      const other = await request(app).post(`/api/messages/${m1new}/tags`).set(auth(a.token)).send({ tag_id: t3 });
      expect([none.status, none.body]).toEqual([other.status, other.body]);
    });
    it('★ ID の形でないタグは 400', async () => {
      expect((await request(app).post(`/api/messages/${m1new}/tags`).set(auth(a.token)).send({ tag_id: 'x' })).status).toBe(400);
    });
  });

  describe('REST の既読', () => {
    const cursor = async () => (await getTestPool().query<{ last_read_message_id: string | null }>(
      'SELECT last_read_message_id FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [r1, a.id])).rows[0]?.last_read_message_id ?? null;
    it('★ 別の部屋の投稿では既読位置を動かさない', async () => {
      await getTestPool().query('DELETE FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [r1, a.id]);
      const res = await request(app).post(`/api/rooms/${r1}/read`).set(auth(a.token)).send({ message_ids: [m3] });
      expect(res.status).toBeLessThan(500);
      expect(await cursor()).toBeNull();
    });
    it('同じ部屋の投稿では動かす (別の部屋の ID が混ざっていても、その部屋の分だけ)', async () => {
      const res = await request(app).post(`/api/rooms/${r1}/read`).set(auth(a.token)).send({ message_ids: [m1old, m3] });
      expect(res.status).toBe(200);
      expect(await cursor()).toBe(m1old);
    });
    it('★ ID の形でないものが混ざっても 500 にしない', async () => {
      const res = await request(app).post(`/api/rooms/${r1}/read`).set(auth(a.token)).send({ message_ids: ['x', m1new] });
      expect(res.status).toBe(200);
      expect(await cursor()).toBe(m1new);
    });
  });

  describe('socket の既読数', () => {
    it('★ 部屋に流す既読数に、別の部屋の投稿を入れない', async () => {
      const watcher = await connect(b.token, [r1]);
      const sender = await connect(a.token, [r1]);
      const got: Array<Record<string, unknown>> = [];
      watcher.on('message:read', (p: { read_counts: Record<string, unknown> }) => { got.push(p.read_counts); });
      sender.emit('message:read', { room_id: r1, message_ids: [m1new, m3, 'x'] });
      await new Promise((r) => setTimeout(r, 400));
      expect(got).toHaveLength(1);
      expect(Object.keys(got[0])).toEqual([m1new]);
    });
  });

  describe('履歴の around / before', () => {
    const ids = (body: { messages: Array<{ id: string }> }) => body.messages.map((m) => m.id);
    it('同じ部屋の投稿を基準にできる', async () => {
      const res = await request(app).get(`/api/rooms/${r1}/messages?before=${m1new}`).set(auth(a.token));
      expect(res.status).toBe(200);
      expect(ids(res.body)).toContain(m1old);
    });
    it('★ 別の部屋の投稿を基準にすると、無いものと同じ (何も返らない)', async () => {
      const before = await request(app).get(`/api/rooms/${r1}/messages?before=${m3}`).set(auth(a.token));
      expect(before.status).toBe(200);
      expect(ids(before.body)).toEqual([]);
      const around = await request(app).get(`/api/rooms/${r1}/messages?around=${m3}`).set(auth(a.token));
      expect(around.status).toBe(200);
      expect(ids(around.body)).toEqual([]);
      // #511 新しい方へ読み足す口も同じ
      const after = await request(app).get(`/api/rooms/${r1}/messages?after=${m3}`).set(auth(a.token));
      expect(after.status).toBe(200);
      expect(ids(after.body)).toEqual([]);
    });
    it('★ ID の形でなければ 400 (500 にしない)', async () => {
      expect((await request(app).get(`/api/rooms/${r1}/messages?before=x`).set(auth(a.token))).status).toBe(400);
      expect((await request(app).get(`/api/rooms/${r1}/messages?around=x`).set(auth(a.token))).status).toBe(400);
      expect((await request(app).get(`/api/rooms/${r1}/messages?after=x`).set(auth(a.token))).status).toBe(400);
    });
  });

  describe('socket call:getStatus', () => {
    const ask = async (s: ClientSocket, roomId: string) => {
      const got: unknown[] = [];
      const h = (p: unknown) => { got.push(p); };
      s.on('call:status', h);
      s.emit('call:getStatus', { roomId });
      await new Promise((r) => setTimeout(r, 300));
      s.off('call:status', h);
      return got;
    };
    it('メンバーの部屋は答える', async () => {
      const s = await connect(a.token, [r1]);
      activeCalls.set(r1, { participants: new Set([b.id]), startedBy: b.id } as never);
      expect(await ask(s, r1)).toEqual([{ roomId: r1, active: true, count: 1, state: 'waiting' }]);
      activeCalls.delete(r1);
    });
    it('★ メンバーでない部屋には答えない (通話中かを知らせない)', async () => {
      const s = await connect(a.token, []);
      activeCalls.set(r3, { participants: new Set([b.id]), startedBy: b.id } as never);
      expect(await ask(s, r3)).toEqual([]);
      activeCalls.delete(r3);
    });
  });
});
