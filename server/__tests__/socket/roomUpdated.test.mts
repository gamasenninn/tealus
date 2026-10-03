/**
 * #489 部屋の設定・メンバーの変化が、ほかのメンバーの画面に読み込み直すまで届かない
 *
 * ★ 部屋が変わったことをメンバーに知らせるイベントが無かった。部屋を開いている B は、A が「メッセージ編集」を
 *   許可しても編集を出せず、B が抜けても A の見出しの人数は古いままだった。
 * ★ 部屋の設定・アイコン・メンバー (追加 / 退会 / 退会させる / 管理者の変更) が変わったら、部屋へ room:updated を送る。
 * ★ 各項に「部屋の外の人には届かない」を並べて置く (全員に配れば通る形にしないため)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('Socket.IO — 部屋の変化を知らせる (#489)', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };   // 管理者
  let b: { id: string; token: string };   // メンバー
  let c: { id: string; token: string };   // 部屋の外
  let roomId: string;

  // ★ 先に接続しておく (部屋を作ったときに受信へ入る、#486)
  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { clients.push(s); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  const events = (s: ClientSocket) => {
    const got: Array<Record<string, unknown>> = [];
    s.on('room:updated', (d: Record<string, unknown>) => got.push(d));
    return got;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });

  let sb: ClientSocket;
  let sc: ClientSocket;
  beforeEach(async () => {
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP891', display_name: 'Aさん' });
    const ub = await createTestUser({ login_id: 'EMP892', display_name: 'Bさん' });
    const uc = await createTestUser({ login_id: 'EMP893', display_name: 'Cさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    c = { id: uc.user.id, token: uc.token };
    sb = await connect(b.token);
    sc = await connect(c.token);
    roomId = (await request(app).post('/api/rooms').set(auth(a.token)).send({ name: '変わる部屋', member_ids: [b.id] })).body.room.id;
    await settle();
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('D: 部屋の設定を変えると、メンバーの B に届く。部屋の外の C には届かない', async () => {
    const bGot = events(sb);
    const cGot = events(sc);
    await request(app).put(`/api/rooms/${roomId}`).set(auth(a.token)).send({ message_edit_policy: 'sender' }).expect(200);
    await settle();
    expect(bGot.map((e) => e.room_id)).toEqual([roomId]);
    expect(cGot).toEqual([]);
  });

  it('E: メンバーを追加すると、もとからいる B に届く', async () => {
    const bGot = events(sb);
    await request(app).post(`/api/rooms/${roomId}/members`).set(auth(a.token)).send({ user_id: c.id }).expect(200);
    await settle();
    expect(bGot.map((e) => e.room_id)).toContain(roomId);
  });

  it('E: B が退会すると、残った A に届く', async () => {
    const sa = await connect(a.token);
    sa.emit('room:join', roomId);
    await settle();
    const aGot = events(sa);
    await request(app).delete(`/api/rooms/${roomId}/members/me`).set(auth(b.token)).expect(200);
    await settle();
    expect(aGot.map((e) => e.room_id)).toEqual([roomId]);
  });

  it('E: 退会させると、残った B に届く', async () => {
    await request(app).post(`/api/rooms/${roomId}/members`).set(auth(a.token)).send({ user_id: c.id }).expect(200);
    await settle();
    const bGot = events(sb);
    await request(app).delete(`/api/rooms/${roomId}/members/${c.id}`).set(auth(a.token)).expect(200);
    await settle();
    expect(bGot.map((e) => e.room_id)).toEqual([roomId]);
  });

  it('E: 管理者を変えると、B に届く', async () => {
    const bGot = events(sb);
    await request(app).put(`/api/rooms/${roomId}/members/${b.id}/role`).set(auth(a.token)).send({ role: 'admin' }).expect(200);
    await settle();
    expect(bGot.map((e) => e.room_id)).toEqual([roomId]);
  });
});
