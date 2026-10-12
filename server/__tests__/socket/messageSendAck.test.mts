/**
 * #593 画面の投稿 (socket message:send) に受け取りの返事 (ack) を返す。
 * ★ 以前は断ったとき (メンバーでない・返信先が不正・保存の失敗など) 何も返さず、画面は送れたつもりで入力欄を消していた
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

type Ack = { ok: boolean; id?: string; error?: string };

describe('#593 message:send の受け取りの返事', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };
  let roomId: string;
  let otherId: string;

  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); resolve(s); });
    s.on('connect_error', reject);
  });
  const send = (s: ClientSocket, payload: Record<string, unknown>) =>
    new Promise<Ack>((resolve) => s.emit('message:send', payload, (ack: Ack) => resolve(ack)));

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((r) => appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; r(); }));
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP201', display_name: 'Aさん' });
    const uc = await createTestUser({ login_id: 'EMP203', display_name: 'Cさん' });
    a = { id: ua.user.id, token: ua.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${a.token}`).send({ name: 'Aの部屋', member_ids: [] })).body.room.id;
    otherId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${uc.token}`).send({ name: 'Cの部屋', member_ids: [] })).body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★ 保存できたら ok と投稿の ID', async () => {
    const s = await connect(a.token);
    const ack = await send(s, { room_id: roomId, content: 'こんにちは' });
    expect(ack.ok).toBe(true);
    expect(typeof ack.id).toBe('string');
  });

  it('★ メンバーでない部屋へは ok: false と理由 (日本語)', async () => {
    const s = await connect(a.token);
    const ack = await send(s, { room_id: otherId, content: 'こんにちは' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('メンバーではない');
  });

  it('★ 返信先が別の部屋の投稿なら ok: false と理由', async () => {
    const s = await connect(a.token);
    const ack = await send(s, { room_id: roomId, content: 'x', reply_to: '00000000-0000-4000-8000-000000000000' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeTruthy();
  });

  it('空の本文は ok: false', async () => {
    const s = await connect(a.token);
    const ack = await send(s, { room_id: roomId, content: '   ' });
    expect(ack.ok).toBe(false);
  });

  it('返事を受け取らない古い画面 (ack 無しの emit) でも今までどおり保存される', async () => {
    const s = await connect(a.token);
    const got = new Promise((r) => s.once('message:new', r));
    s.emit('message:send', { room_id: roomId, content: '古い画面' });
    s.emit('room:join', roomId);
    await expect(Promise.race([got, new Promise((r) => setTimeout(() => r('timeout'), 1500))])).resolves.not.toBe('timeout');
  });
});
