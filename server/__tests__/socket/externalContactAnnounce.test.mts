/**
 * 改善ループ 51: 管理者が口座の「社外の窓口」の印や役割 (ゲスト) を変えたら、その口座のいる部屋に room:updated を送る
 *
 * ★ 以前は名前を変えたときしか知らせず、印・役割だけを変えると、ほかの人の一覧は次に取り直すまで
 *   古い振り分け (タブ「お客様」に入る・入らない) のままだった
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('改善ループ 51 印・役割の変更を部屋に知らせる', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let admin: { id: string; token: string };
  let mate: { id: string; token: string };
  let window: { id: string; token: string };
  let roomId: string;

  const connect = (token: string, join?: string) => new Promise<ClientSocket>((resolve, reject) => {
    const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    c.on('connect', () => { clients.push(c); if (join) c.emit('room:join', join); setTimeout(() => resolve(c), 200); });
    c.on('connect_error', reject);
  });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const updates = (s: ClientSocket) => { const got: unknown[] = []; s.on('room:updated', (d: unknown) => got.push(d)); return got; };

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => { appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); }); });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const a = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.user.id]);
    const b = await createTestUser({ login_id: 'EMP002', display_name: '店の人' });
    const w = await createTestUser({ login_id: 'ec-front', display_name: 'EC窓口' });
    admin = { id: a.user.id, token: a.token };
    mate = { id: b.user.id, token: b.token };
    window = { id: w.user.id, token: w.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${mate.token}`)
      .send({ name: 'EC の部屋', member_ids: [window.id] })).body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★ 社外の窓口の印を付けたら、その口座のいる部屋の人に room:updated が届く', async () => {
    const m = await connect(mate.token, roomId);
    const got = updates(m);
    const res = await request(app).put(`/api/admin/users/${window.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_external_contact: true });
    expect(res.status).toBe(200);
    await settle();
    expect(got).toEqual([{ room_id: roomId }]);
  });

  it('★ 役割をゲストに変えても届く (ゲストのいる部屋も「お客様」に入るため)', async () => {
    const m = await connect(mate.token, roomId);
    const got = updates(m);
    await request(app).put(`/api/admin/users/${window.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ role: 'guest' });
    await settle();
    expect(got).toEqual([{ room_id: roomId }]);
  });

  it('印も役割も変わらない更新では送らない', async () => {
    const m = await connect(mate.token, roomId);
    const got = updates(m);
    await request(app).put(`/api/admin/users/${window.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_external_contact: false });
    await settle();
    expect(got).toEqual([]);
  });
});
