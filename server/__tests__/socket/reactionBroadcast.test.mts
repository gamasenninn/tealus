/**
 * #488 リアクションの知らせに「自分が付けたか (me)」を付けた本人の目線で入れて全員に配っていた
 *
 * ★ B が付けると、A の画面でも「自分が付けた」と表示された (読み込み直すと消える)。
 *   A がそれを見て押すと、取り消しのつもりで A のリアクションが増える。
 * ★ 配るのは「誰が付けたか (user_ids)」。me は各端末が自分の ID で決める。付けた本人への HTTP の応答は me を持つ (本人の目線で正しい)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

type Broadcast = { message_id: string; reactions: Array<Record<string, unknown>> };

describe('Socket.IO — リアクションの知らせ (#488)', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };
  let b: { id: string; token: string };
  let roomId: string;
  let msgId: string;

  const connect = (token: string, join: string[]) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); for (const r of join) s.emit('room:join', r); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const react = (token: string, emoji: string) =>
    request(app).post(`/api/rooms/${roomId}/messages/${msgId}/reactions`).set('Authorization', `Bearer ${token}`).send({ emoji });

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP881', display_name: 'Aさん' });
    const ub = await createTestUser({ login_id: 'EMP882', display_name: 'Bさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'リアクションの部屋', member_ids: [b.id] })).body.room.id;
    msgId = (await request(app).post(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${a.token}`)
      .send({ content: 'A の投稿' })).body.message.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★ 配る知らせに me を入れない。代わりに誰が付けたか (user_ids) を入れる', async () => {
    const sa = await connect(a.token, [roomId]);
    const got: Broadcast[] = [];
    sa.on('message:reaction', (d: Broadcast) => got.push(d));

    await react(b.token, '👍').expect(200);
    await settle();

    expect(got).toHaveLength(1);
    const thumbs = got[0].reactions.find((r) => r.emoji === '👍')!;
    expect(thumbs).toBeDefined();
    expect(thumbs.count).toBe(1);
    expect(thumbs.user_ids).toEqual([b.id]);
    expect('me' in thumbs).toBe(false);   // ★ B の目線の true が A に届いていた
  });

  it('同じ絵文字を 2 人が付けると、user_ids に 2 人とも入る', async () => {
    const sa = await connect(a.token, [roomId]);
    const got: Broadcast[] = [];
    sa.on('message:reaction', (d: Broadcast) => got.push(d));

    await react(b.token, '👍').expect(200);
    await react(a.token, '👍').expect(200);
    await settle();

    const last = got[got.length - 1].reactions.find((r) => r.emoji === '👍')!;
    expect(last.count).toBe(2);
    expect([...(last.user_ids as string[])].sort()).toEqual([a.id, b.id].sort());
  });

  it('付けた本人への HTTP の応答は me を持つ (本人の目線で正しい)', async () => {
    const res = await react(b.token, '👍').expect(200);
    expect(res.body.reactions.find((r: { emoji: string }) => r.emoji === '👍')).toMatchObject({ count: 1, me: true });
  });
});
