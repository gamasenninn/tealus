/**
 * socket の操作はその部屋のメンバーだけ (2026-09-30)
 * ★ 通話の開始・終了・拒否、既読、入力中。どれも以前は部屋の ID だけで動いた
 * ★ 各項に「メンバーなら動く」を並べて置く (何もしなくても「動かない」が通る形にしないため)
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import * as capabilityWatcher from '../../src/services/capabilityWatcher.mts';
import { activeCalls } from '../../src/socket/handlers/call.mts';

describe('Socket.IO — 部屋の操作はメンバーだけ', () => {
  let port: number;
  let rtc: http.Server;
  const clients: ClientSocket[] = [];
  let a: { id: string; token: string };   // 部屋のメンバー
  let b: { id: string; token: string };   // 部屋のメンバー
  let c: { id: string; token: string };   // どちらの部屋にも入っていない
  let dmId: string;      // a と b の DM
  let otherId: string;   // c だけの部屋

  const connect = (token: string, join: string[] = []) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => {
      clients.push(s);
      for (const r of join) s.emit('room:join', r);
      setTimeout(() => resolve(s), 200);
    });
    s.on('connect_error', reject);
  });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  const events = (s: ClientSocket, name: string) => {
    const got: unknown[] = [];
    s.on(name, (d: unknown) => got.push(d));
    return got;
  };
  const systemMessages = async (roomId: string) =>
    (await getTestPool().query<{ content: string }>(
      `SELECT content FROM messages WHERE room_id = $1 AND type = 'system' ORDER BY created_at`, [roomId])).rows.map((r) => r.content);

  beforeAll(async () => {
    await setupTestDb();
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    // ★ 通話は「通話サーバが動いている」ときだけ受け付ける。手元に健康確認の口を立てて、本物の経路で状態を作る
    rtc = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });
    await new Promise<void>((r) => rtc.listen(0, '127.0.0.1', r));
    process.env.RTC_PORT = String((rtc.address() as AddressInfo).port);
    await capabilityWatcher.checkAndEmit();
    expect(capabilityWatcher.getState()).toBe(true);
  });
  afterAll(async () => {
    capabilityWatcher.stop();
    delete process.env.RTC_PORT;
    rtc.close();
    appServer.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    await cleanTestDb();
    activeCalls.clear();
    const ua = await createTestUser({ login_id: 'EMP101', display_name: 'Aさん' });
    const ub = await createTestUser({ login_id: 'EMP102', display_name: 'Bさん' });
    const uc = await createTestUser({ login_id: 'EMP103', display_name: 'Cさん' });
    a = { id: ua.user.id, token: ua.token };
    b = { id: ub.user.id, token: ub.token };
    c = { id: uc.user.id, token: uc.token };
    dmId = (await request(app).post('/api/rooms/direct').set('Authorization', `Bearer ${a.token}`).send({ partner_id: b.id })).body.room.id;
    otherId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${c.token}`).send({ name: 'Cの部屋', member_ids: [] })).body.room.id;
  });
  afterEach(() => { while (clients.length) clients.pop()!.close(); });

  describe('call:start', () => {
    it('メンバーなら通話が始まる (投稿が 1 通でき、相手に着信が届く)', async () => {
      const sb = await connect(b.token, [dmId]);
      const incoming = events(sb, 'call:incoming');
      const sa = await connect(a.token, [dmId]);
      sa.emit('call:start', { roomId: dmId });
      await settle();
      expect(await systemMessages(dmId)).toEqual(['📞 Aさん が通話を開始しました']);
      expect(incoming).toHaveLength(1);
    });

    it('★ メンバーでなければ何も起きない (投稿も着信も無い)', async () => {
      const sb = await connect(b.token, [dmId]);
      const incoming = events(sb, 'call:incoming');
      const sc = await connect(c.token);
      sc.emit('call:start', { roomId: dmId });
      await settle();
      expect(await systemMessages(dmId)).toEqual([]);
      expect(incoming).toHaveLength(0);
      expect(activeCalls.has(dmId)).toBe(false);
    });

    it('形の崩れた ID でも落ちない', async () => {
      const sc = await connect(c.token);
      sc.emit('call:start', { roomId: 'not-a-uuid' });
      sc.emit('call:start', null);
      await settle();
      expect(sc.connected).toBe(true);
    });
  });

  describe('call:end', () => {
    it('★ 通話に入っていないメンバー外の人は、終了の通知を流せない', async () => {
      const sa = await connect(a.token, [dmId]);
      const sb = await connect(b.token, [dmId]);
      const ended = events(sb, 'call:ended');
      sa.emit('call:start', { roomId: dmId });
      await settle();
      const sc = await connect(c.token);
      sc.emit('call:end', { roomId: dmId });
      await settle();
      expect(ended).toHaveLength(0);
      expect(activeCalls.get(dmId)?.participants.size).toBe(1);
    });

    it('通話に入っている人は終えられる (終了の投稿ができる)', async () => {
      const sa = await connect(a.token, [dmId]);
      sa.emit('call:start', { roomId: dmId });
      await settle();
      sa.emit('call:end', { roomId: dmId });
      await settle();
      expect(await systemMessages(dmId)).toEqual(['📞 Aさん が通話を開始しました', '📞 通話が終了しました']);
    });
  });

  describe('call:reject', () => {
    it('その部屋で通話を始めた人にだけ、メンバーから拒否を返せる', async () => {
      const sa = await connect(a.token, [dmId]);
      const rejected = events(sa, 'call:rejected');
      sa.emit('call:start', { roomId: dmId });
      await settle();
      const sb = await connect(b.token, [dmId]);
      sb.emit('call:reject', { roomId: dmId, callerId: a.id });
      await settle();
      expect(rejected).toHaveLength(1);
    });

    // ★ 2026-10-09 UI 試験で: 拒否された発信側は画面を閉じるが call:end を送らず、部屋が「待機中」のまま
    //   本体の再起動まで残った。古いビルドの端末でも直るよう、サーバーで終える
    it('★ 拒否されると、発信者だけが残った通話は終わる (「待機中」が残らない)', async () => {
      const sa = await connect(a.token, [dmId]);
      sa.emit('call:start', { roomId: dmId });
      await settle();
      const sb = await connect(b.token, [dmId]);
      const status = events(sb, 'call:status');
      sb.emit('call:reject', { roomId: dmId, callerId: a.id });
      await settle();
      expect(activeCalls.has(dmId)).toBe(false);
      expect(await systemMessages(dmId)).toEqual(['📞 Aさん が通話を開始しました', '📞 通話が終了しました']);
      expect(status).toContainEqual({ roomId: dmId, active: false, count: 0 });
    });

    it('★ もう 2 人で話している通話は、拒否が届いても終わらない', async () => {
      const sa = await connect(a.token, [dmId]);
      sa.emit('call:start', { roomId: dmId });
      await settle();
      const sb = await connect(b.token, [dmId]);
      sb.emit('call:start', { roomId: dmId });   // 別の端末で応答済み
      await settle();
      sb.emit('call:reject', { roomId: dmId, callerId: a.id });   // 残っていた着信の画面から
      await settle();
      expect(activeCalls.get(dmId)?.participants.size).toBe(2);
      expect(await systemMessages(dmId)).toEqual(['📞 Aさん が通話を開始しました']);
    });

    it('★ 通話が無い・メンバーでない場合は、相手に何も届かない', async () => {
      const sa = await connect(a.token, [dmId]);
      const rejected = events(sa, 'call:rejected');
      const sc = await connect(c.token);
      sc.emit('call:reject', { roomId: dmId, callerId: a.id });        // メンバーでない
      const sb = await connect(b.token, [dmId]);
      sb.emit('call:reject', { roomId: dmId, callerId: a.id });        // 通話が無い
      await settle();
      expect(rejected).toHaveLength(0);
    });
  });

  describe('message:read', () => {
    const cursor = async (roomId: string, userId: string) =>
      (await getTestPool().query('SELECT 1 FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomId, userId])).rows.length;

    it('メンバーなら既読位置が進む', async () => {
      const sa = await connect(a.token, [dmId]);
      const sb = await connect(b.token, [dmId]);
      sa.emit('message:send', { room_id: dmId, content: 'こんにちは' });
      await settle();
      const msgId = (await getTestPool().query<{ id: string }>(`SELECT id FROM messages WHERE room_id = $1 AND type = 'text'`, [dmId])).rows[0].id;
      sb.emit('message:read', { room_id: dmId, message_ids: [msgId] });
      await settle();
      expect(await cursor(dmId, b.id)).toBe(1);
    });

    it('★ メンバーでなければ既読位置を書かない (既読数も増えない)', async () => {
      const sa = await connect(a.token, [dmId]);
      sa.emit('message:send', { room_id: dmId, content: 'こんにちは' });
      await settle();
      const msgId = (await getTestPool().query<{ id: string }>(`SELECT id FROM messages WHERE room_id = $1 AND type = 'text'`, [dmId])).rows[0].id;
      const sc = await connect(c.token);
      sc.emit('message:read', { room_id: dmId, message_ids: [msgId] });
      await settle();
      expect(await cursor(dmId, c.id)).toBe(0);
    });

    it('★ 別の部屋のメッセージでは、この部屋の既読位置を進めない', async () => {
      const sc = await connect(c.token, [otherId]);
      sc.emit('message:send', { room_id: otherId, content: 'Cの部屋の投稿' });
      await settle();
      const foreignId = (await getTestPool().query<{ id: string }>(`SELECT id FROM messages WHERE room_id = $1 AND type = 'text'`, [otherId])).rows[0].id;
      const sa = await connect(a.token, [dmId]);
      sa.emit('message:read', { room_id: dmId, message_ids: [foreignId] });
      await settle();
      expect(await cursor(dmId, a.id)).toBe(0);
    });
  });

  describe('typing', () => {
    it('メンバーの「入力中」は同じ部屋のメンバーに届く', async () => {
      const sb = await connect(b.token, [dmId]);
      const typing = events(sb, 'typing:start');
      const sa = await connect(a.token, [dmId]);
      sa.emit('typing:start', dmId);
      await settle();
      expect(typing).toHaveLength(1);
    });

    it('★ メンバーでなければ「入力中」は届かない', async () => {
      const sb = await connect(b.token, [dmId]);
      const typing = events(sb, 'typing:start');
      const stop = events(sb, 'typing:stop');
      const sc = await connect(c.token, [dmId]); // room:join は断られる
      sc.emit('typing:start', dmId);
      sc.emit('typing:stop', dmId);
      await settle();
      expect(typing).toHaveLength(0);
      expect(stop).toHaveLength(0);
    });
  });
});
