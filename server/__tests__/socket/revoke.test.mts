/**
 * 取り消した権限は、接続中の端末にもその場で効く (2026-09-30)
 * ★ 部屋から外す・自分で退会する → その部屋の配信から抜ける
 * ★ 利用停止 → 接続を切る
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('Socket.IO — 取り消した権限が接続中にも効く', () => {
  let port: number;
  const clients: ClientSocket[] = [];
  let admin: { id: string; token: string };
  let member: { id: string; token: string };
  let third: { id: string; token: string };
  let roomId: string;

  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const c = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    // ★ 一般の利用者は、画面が room:join を送った部屋にだけ入る (管理者は全部屋に自動で入る)。
    //   入らないまま試すと「届かない」が何もしなくても通ってしまうので、必ず入ってから試す
    c.on('connect', () => { clients.push(c); c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
    c.on('connect_error', reject);
  });
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  /** sender から 1 通送り、receiver に届いた本文を集める */
  const deliveredTo = async (sender: ClientSocket, receiver: ClientSocket, content: string) => {
    const got: string[] = [];
    const onNew = (m: { content?: string }) => { if (m.content) got.push(m.content); };
    receiver.on('message:new', onNew);
    sender.emit('message:send', { room_id: roomId, content });
    await settle(300);
    receiver.off('message:new', onNew);
    return got.includes(content);
  };

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
  });
  afterAll(async () => { appServer.close(); await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const a = await createTestUser({ login_id: 'ADM001', display_name: '管理者' });
    const m = await createTestUser({ login_id: 'EMP002', display_name: '外される人' });
    const t = await createTestUser({ login_id: 'EMP003', display_name: '残る人' });
    await getTestPool().query("UPDATE users SET role = 'admin' WHERE id = $1", [a.user.id]);
    admin = { id: a.user.id, token: a.token };
    member = { id: m.user.id, token: m.token };
    third = { id: t.user.id, token: t.token };
    const roomRes = await request(app).post('/api/rooms').set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'テスト', member_ids: [member.id, third.id] });
    roomId = roomRes.body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  it('外される前は届く (前提の確認)', async () => {
    const a = await connect(admin.token);
    const m = await connect(member.token);
    expect(await deliveredTo(a, m, '外す前')).toBe(true);
  });

  it('★ 部屋から外されたら、接続中の端末 (2 台とも) にもその部屋の投稿が届かない', async () => {
    const a = await connect(admin.token);
    const m1 = await connect(member.token);
    const m2 = await connect(member.token);
    const res = await request(app).delete(`/api/rooms/${roomId}/members/${member.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    await settle();
    expect(await deliveredTo(a, m1, '外した後 1')).toBe(false);
    expect(await deliveredTo(a, m2, '外した後 2')).toBe(false);
  });

  it('★ 外された人以外には、これまでどおり届く', async () => {
    const a = await connect(admin.token);
    const t = await connect(third.token);
    await request(app).delete(`/api/rooms/${roomId}/members/${member.id}`).set('Authorization', `Bearer ${admin.token}`);
    await settle();
    expect(await deliveredTo(a, t, '残る人へ')).toBe(true);
  });

  it('★ 自分で退会したら、接続中の端末にもその部屋の投稿が届かない', async () => {
    const a = await connect(admin.token);
    const m = await connect(member.token);
    const res = await request(app).delete(`/api/rooms/${roomId}/members/me`).set('Authorization', `Bearer ${member.token}`);
    expect(res.status).toBe(200);
    await settle();
    expect(await deliveredTo(a, m, '退会した後')).toBe(false);
  });

  it('★★ 利用停止にしたら、その人の接続を切る', async () => {
    const m = await connect(member.token);
    const disconnected = new Promise<void>((resolve) => m.on('disconnect', () => resolve()));
    const res = await request(app).patch(`/api/admin/users/${member.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_active: false });
    expect(res.status).toBe(200);
    await Promise.race([disconnected, settle(1000)]);
    expect(m.connected).toBe(false);
  });

  // ★ #529 管理者は接続時に全部屋へ入る。役割を変えても接続が残ると、一般に戻した後も全部屋の配信を受けた
  it('★★ 役割を変えたら、その人の接続を切る (つなぎ直して新しい役割で入り直す)', async () => {
    const m = await connect(member.token);
    const disconnected = new Promise<void>((resolve) => m.on('disconnect', () => resolve()));
    const res = await request(app).put(`/api/admin/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ role: 'admin' });
    expect(res.status).toBe(200);
    await Promise.race([disconnected, settle(1000)]);
    expect(m.connected).toBe(false);
  });

  it('役割を変えない更新 (表示名だけ) では切らない', async () => {
    const m = await connect(member.token);
    await request(app).put(`/api/admin/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.token}`).send({ display_name: '新しい名前' });
    await settle(300);
    expect(m.connected).toBe(true);
  });

  it('利用を再開しても、他の人の接続は切らない', async () => {
    const t = await connect(third.token);
    await request(app).patch(`/api/admin/users/${member.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`).send({ is_active: true });
    await settle();
    expect(t.connected).toBe(true);
  });
});
