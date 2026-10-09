/**
 * #534 表示名・アイコンを変えたら、同じ部屋の人に user:updated を送る
 *
 * ★ 以前は本体の socket が持つ名前を書き換えるだけで (#498)、誰にも知らせなかった。
 *   相手の画面では 1 対 1 の一覧・見出し・メンバー一覧・過去の吹き出しが、読み込み直すまで古い名前のままだった
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('#534 プロフィールの変更を同じ部屋の人へ', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let me: { id: string; token: string };
  let mate: { id: string; token: string };
  let stranger: { id: string; token: string };
  let roomId: string;

  const connect = (token: string, join?: string) => new Promise<ClientSocket>((resolve, reject) => {
    const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    c.on('connect', () => { clients.push(c); if (join) c.emit('room:join', join); setTimeout(() => resolve(c), 200); });
    c.on('connect_error', reject);
  });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const events = (s: ClientSocket) => { const got: unknown[] = []; s.on('user:updated', (d: unknown) => got.push(d)); return got; };

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => { appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); }); });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const a = await createTestUser({ login_id: 'EMP001', display_name: '田中' });
    const b = await createTestUser({ login_id: 'EMP002', display_name: '同じ部屋' });
    const c = await createTestUser({ login_id: 'EMP003', display_name: '関係ない人' });
    me = { id: a.user.id, token: a.token };
    mate = { id: b.user.id, token: b.token };
    stranger = { id: c.user.id, token: c.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${me.token}`)
      .send({ name: '部屋', member_ids: [mate.id] })).body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('★★ 表示名を変えたら、同じ部屋の人に新しい名前が届く', async () => {
    const m = await connect(mate.token, roomId);
    const got = events(m);
    const res = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`).send({ display_name: '田中 (営業)' });
    expect(res.status).toBe(200);
    await settle();
    expect(got).toEqual([{ user_id: me.id, display_name: '田中 (営業)', avatar_url: null }]);
  });

  it('★ 部屋を共有していない人には届かない', async () => {
    const s = await connect(stranger.token);
    const got = events(s);
    await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`).send({ display_name: '田中 (営業)' });
    await settle();
    expect(got).toEqual([]);
  });

  it('★ 自分の別の端末にも届く (部屋を開いていなくても)', async () => {
    const mine = await connect(me.token);
    const got = events(mine);
    await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`).send({ display_name: '田中 (営業)' });
    await settle();
    expect(got).toHaveLength(1);
  });

  it('名前を変えない更新 (ひとこと・通知音) では送らない', async () => {
    const m = await connect(mate.token, roomId);
    const got = events(m);
    await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${me.token}`).send({ status_message: 'こんにちは', notification_sound: false });
    await settle();
    expect(got).toEqual([]);
  });
});
