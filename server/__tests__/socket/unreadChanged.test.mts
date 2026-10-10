/**
 * #532 既読を付けたら、同じ人の全端末に「未読が変わった」(unread:changed) を送る
 *
 * ★ 以前は同じ部屋の他の人に既読の数を配るだけで、同じ人の別の端末には何も届かなかった。
 *   スマホで読んでも、PC の部屋の一覧の未読数とアプリのバッジが、次の新着か読み込み直すまで残った
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('#532 既読で、同じ人の全端末に unread:changed', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let me: { id: string; token: string };
  let other: { id: string; token: string };
  let roomId: string;
  let msgId: string;

  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    c.on('connect', () => { clients.push(c); c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
    c.on('connect_error', reject);
  });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  // ★ 届くはずのものは「届くまで」待つ (最大 3 秒)。固定 300ms だと遅い CI で取りこぼし、10-10 に 1 回落ちた
  const until = async (ok: () => boolean, ms = 3000) => {
    for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms;) await settle(25);
    await settle(100);   // 余分に届かないことも見る
  };
  const events = (s: ClientSocket) => { const got: unknown[] = []; s.on('unread:changed', (d: unknown) => got.push(d)); return got; };

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => { appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); }); });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const a = await createTestUser({ login_id: 'EMP001', display_name: '自分' });
    const b = await createTestUser({ login_id: 'EMP002', display_name: '相手' });
    me = { id: a.user.id, token: a.token };
    other = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${other.token}`)
      .send({ name: '部屋', member_ids: [me.id] })).body.room.id;
    const { rows } = await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '相手の投稿', 'text') RETURNING id`, [roomId, other.id]);
    msgId = rows[0].id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★★ REST で既読にすると、自分の別の端末に届く', async () => {
    const pc = await connect(me.token);
    const got = events(pc);
    const res = await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${me.token}`).send({ message_ids: [msgId] });
    expect(res.status).toBe(200);
    await until(() => got.length > 0);
    expect(got).toEqual([{ room_id: roomId }]);
  });

  it('★★ socket で既読にしても、自分の別の端末に届く', async () => {
    const pc = await connect(me.token);
    const phone = await connect(me.token);
    const got = events(pc);
    phone.emit('message:read', { room_id: roomId, message_ids: [msgId] });
    await until(() => got.length > 0);
    expect(got).toEqual([{ room_id: roomId }]);
  });

  it('★ 「すべて既読」でも届く', async () => {
    const pc = await connect(me.token);
    const got = events(pc);
    await request(app).post(`/api/rooms/${roomId}/read/all`).set('Authorization', `Bearer ${me.token}`);
    await until(() => got.length > 0);
    expect(got).toEqual([{ room_id: roomId }]);
  });

  it('★ 他の人には届かない (自分の未読の話なので)', async () => {
    const theirs = await connect(other.token);
    const got = events(theirs);
    await request(app).post(`/api/rooms/${roomId}/read`).set('Authorization', `Bearer ${me.token}`).send({ message_ids: [msgId] });
    await settle();
    expect(got).toEqual([]);
  });
});
