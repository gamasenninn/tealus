/**
 * system メッセージ (#2 通話 / #10 #11 スタンプ / #12 入退室 / #12' ボットの参加): 配信の中身を固定する (#383 段階 1、2026-10-01)
 *
 * ★ どれも付随処理は配信だけ (通知・AI 通知・プレビューは意図して無し、docs/07 §3.1)。
 *   announcePost へ移す前に、**配信の中身**を固定する。移す前のコードで通ることを先に確かめる
 * ★ 経路ごとに名前の付け方が違う (入退室は「システム」/ スタンプは作った人 / 通話は名前なし)。揃えずに今のまま残す
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

const recorded: { machine: unknown[]; push: unknown[]; webhook: unknown[]; preview: unknown[] } = { machine: [], push: [], webhook: [], preview: [] };
jest.mock('../../src/services/machinePush.mts', () => {
  const actual = jest.requireActual('../../src/services/machinePush.mts');
  return { ...actual, pushMachinePost: jest.fn(async (post: unknown) => { recorded.machine.push(post); }) };
});
jest.mock('../../src/services/push.mts', () => {
  const actual = jest.requireActual('../../src/services/push.mts');
  return { ...actual, sendPushToRoomMembers: jest.fn(async (...a: unknown[]) => { recorded.push.push(a); }) };
});
jest.mock('../../src/services/webhook.mts', () => {
  const actual = jest.requireActual('../../src/services/webhook.mts');
  return { ...actual, fireWebhooks: jest.fn((...a: unknown[]) => { if (a[0] === 'message.created') recorded.webhook.push(a); }) };
});
jest.mock('../../src/services/linkPreview.mts', () => {
  const actual = jest.requireActual('../../src/services/linkPreview.mts');
  return { ...actual, processLinkPreviews: jest.fn(async (...a: unknown[]) => { recorded.preview.push(a); }) };
});
const stampMode = { fail: false };
jest.mock('../../src/services/stamp/index.mts', () => ({
  generateStampPack: jest.fn(async () => {
    if (stampMode.fail) throw new Error('生成失敗 (テスト)');
    return { gridBuffer: Buffer.alloc(0), detailedPrompt: 'x', stamps: [{}] };
  }),
  saveStampFiles: jest.fn(async (packId: string) => [{ filePath: `stamps/${packId}/0.png`, label: 'a', index: 0 }]),
  checkDailyLimit: jest.fn(async () => 0),
}));

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import * as capabilityWatcher from '../../src/services/capabilityWatcher.mts';
import { activeCalls } from '../../src/socket/handlers/call.mts';

describe('system メッセージ: 配信の中身', () => {
  let port: number;
  let rtc: http.Server;
  let owner: { id: string; token: string };
  let bot: { id: string; token: string };
  let guest: { id: string };
  let roomId: string;
  let room2: string;
  let watcher: ClientSocket;
  const emitted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    rtc = http.createServer((_q, r) => { r.statusCode = 200; r.end('ok'); });
    await new Promise<void>((r) => rtc.listen(0, '127.0.0.1', r));
    process.env.RTC_PORT = String((rtc.address() as AddressInfo).port);
    await capabilityWatcher.checkAndEmit();
    activeCalls.clear();

    await cleanTestDb();
    const o = await createTestUser({ login_id: 'EMP831', display_name: '持ち主' });
    const b = await createTestUser({ login_id: 'BOT831', display_name: '入るボット' });
    const g = await createTestUser({ login_id: 'EMP832', display_name: '招かれる人' });
    const w = await createTestUser({ login_id: 'EMP833', display_name: '見ている人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    owner = { id: o.user.id, token: o.token };
    bot = { id: b.user.id, token: b.token };
    guest = { id: g.user.id };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${o.token}`).send({ name: 'system の部屋', member_ids: [w.user.id] })).body.room.id;
    room2 = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${o.token}`).send({ name: 'ボットが入る部屋', member_ids: [w.user.id] })).body.room.id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      s.on('connect', () => { s.emit('room:join', roomId); s.emit('room:join', room2); setTimeout(() => resolve(s), 200); });
      s.on('connect_error', reject);
    });
    watcher.on('message:new', (m: Record<string, unknown>) => { emitted.push(m); });
  });
  afterAll(async () => {
    watcher?.close();
    capabilityWatcher.stop();
    delete process.env.RTC_PORT;
    rtc?.close();
    appServer.close();
    await closeTestDb();
  });

  beforeEach(() => {
    emitted.length = 0;
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
  });

  const settle = async (n = 1) => {
    for (let i = 0; i < 80 && emitted.length < n; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };

  /** 配信の中身のうち、毎回変わらない部分 (ID は一致だけ見る) */
  const stable = (m: Record<string, unknown>, room: string, senderId: string | null) => ({
    keys: Object.keys(m).sort(),
    room_matches: m.room_id === room,
    sender_matches: senderId === null ? 'any' : m.sender_id === senderId,
    content: m.content, type: m.type,
    sender_display_name: m.sender_display_name,
  });

  const noOtherEffects = () => {
    expect(recorded.push).toEqual([]);
    expect(recorded.machine).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
  };

  it('#12 入退室 (人の招待): 名前は「システム」', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/members`).set('Authorization', `Bearer ${owner.token}`).send({ user_id: guest.id });
    expect(res.status).toBe(200);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0], roomId, null)).toMatchSnapshot();
    noOtherEffects();
  });

  it("#12' ボットが自分で入る: 名前は「システム」", async () => {
    const res = await request(app).post(`/api/bot/rooms/${room2}/join`).set('Authorization', `Bearer ${bot.token}`);
    expect(res.status).toBe(200);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0], room2, null)).toMatchSnapshot();
    noOtherEffects();
  });

  it('#10 スタンプの完成: 名前は作った人', async () => {
    stampMode.fail = false;
    const res = await request(app).post('/api/stamps/generate').set('Authorization', `Bearer ${owner.token}`).send({ prompt: 'ねこ', name: 'ねこパック', room_id: roomId });
    expect(res.status).toBe(202);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0], roomId, owner.id)).toMatchSnapshot();
    noOtherEffects();
  });

  it('#11 スタンプの失敗: 名前は作った人', async () => {
    stampMode.fail = true;
    try {
      const res = await request(app).post('/api/stamps/generate').set('Authorization', `Bearer ${owner.token}`).send({ prompt: 'いぬ', name: 'いぬパック', room_id: roomId });
      expect(res.status).toBe(202);
      await settle();
      expect(emitted).toHaveLength(1);
      expect(stable(emitted[0], roomId, owner.id)).toMatchSnapshot();
      noOtherEffects();
    } finally { stampMode.fail = false; }
  });

  it('#2 通話の開始・終了: 名前は付けない', async () => {
    const s = await new Promise<ClientSocket>((resolve) => {
      const c = Client(`http://localhost:${port}`, { auth: { token: owner.token }, transports: ['websocket'] });
      c.on('connect', () => { c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
    });
    try {
      s.emit('call:start', { roomId });
      await settle(1);
      s.emit('call:end', { roomId });
      await settle(2);
      expect(emitted).toHaveLength(2);
      expect(emitted.map((m) => stable(m, roomId, owner.id))).toMatchSnapshot();
      noOtherEffects();
    } finally { s.close(); }
  });
});
