/**
 * 投稿経路ごとの付随処理を固定する (#383 第 1 段の段階 0、2026-10-01)
 *
 * ★ docs/07 の表 (手で保守していて 2 回古くなった) を、そのままテストにする。**挙動は何も変えない。**
 *   経路を 1 つの入口へ寄せる (段階 1) ときに、付随処理を 1 つでも落とせばここが落ちる
 * ★ 付随処理 (docs/07 §2):
 *   ① emit    … `message:new` が部屋に届く (同じ部屋の socket で受ける)
 *   ② push    … 人の投稿の通知 (`sendPushToRoomMembers` を直接)
 *      machine … 機械の投稿の通知 (`pushMachinePost` = 部屋の管理者の設定で鳴らすか決まる、#463)
 *   ③ webhook … `fireWebhooks('message.created')` = エージェントが起きる
 *   ④ preview … `processLinkPreviews`
 * ★★ 「無い」は 2 種類ある (docs/07 §3):
 *   意図 … 理由がコードか docs に書いてある
 *   不明 … 何も書かれていない (第 2 段で判断する)。★ ここでは**現状**として固定する。
 *          判断が出て挙動を変えるときは、このテストを**わざと**書き換えること
 * ★ この周の対象: #1 画面の投稿 / #3 メディア / #5 ボットの文字 / #6 ボットの画像 / #7 ボットのファイル /
 *   #8 音声 / #9 REST。system メッセージ・転送・LINE は次の周 (#2 #4 #10〜#18)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

const calls: string[] = [];
jest.mock('../../src/services/push.mts', () => {
  const actual = jest.requireActual('../../src/services/push.mts');
  return { ...actual, sendPushToRoomMembers: jest.fn(async () => { calls.push('push'); }), sendPushToUser: jest.fn(async () => {}) };
});
jest.mock('../../src/services/machinePush.mts', () => {
  const actual = jest.requireActual('../../src/services/machinePush.mts');
  return { ...actual, pushMachinePost: jest.fn(async () => { calls.push('machine'); }) };
});
jest.mock('../../src/services/webhook.mts', () => {
  const actual = jest.requireActual('../../src/services/webhook.mts');
  return { ...actual, fireWebhooks: jest.fn((event: string) => { if (event === 'message.created') calls.push('webhook'); }) };
});
jest.mock('../../src/services/linkPreview.mts', () => {
  const actual = jest.requireActual('../../src/services/linkPreview.mts');
  return { ...actual, processLinkPreviews: jest.fn(async () => { calls.push('preview'); }) };
});
// ★ 音声は文字起こしが裏で走る (外へ出る)。呼ばれたかは見ない (付随処理 4 つの外)
jest.mock('../../src/services/transcription.mts', () => {
  const actual = jest.requireActual('../../src/services/transcription.mts');
  return { ...actual, transcribeVoiceMessage: jest.fn(async () => {}), transcribeMessage: jest.fn(async () => {}) };
});

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

/** 1x1 の PNG (サムネイル生成が通る本物の画像) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const URL_TEXT = 'リンク https://example.com/x';

describe('投稿経路ごとの付随処理 (docs/07 の表)', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let watcher: ClientSocket;
  let emits = 0;

  beforeAll(async () => {
    await setupTestDb();
    // ★ 本番の DB に触れていないことを先に確かめる (docs/05、feedback: request(app) は本番に繋がりうる)
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP601', display_name: '人' });
    const b = await createTestUser({ login_id: 'BOT601', display_name: 'ボット' });
    const w = await createTestUser({ login_id: 'EMP602', display_name: '見ている人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '経路の部屋', member_ids: [b.user.id, w.user.id] })).body.room.id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      s.on('connect', () => { s.emit('room:join', roomId); setTimeout(() => resolve(s), 200); });
      s.on('connect_error', reject);
    });
    watcher.on('message:new', () => { emits++; });
  });
  afterAll(async () => {
    watcher?.close();
    appServer.close();
    await closeTestDb();
  });

  /** 1 経路を走らせ、付随処理の集合を返す。★ 決め打ちの待ちに頼らず、emit が届くまで待ってから少し待つ */
  async function run(act: () => Promise<unknown>): Promise<string[]> {
    calls.length = 0;
    const before = emits;
    await act();
    for (let i = 0; i < 40 && emits === before; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 150)); // ★ 応答の後に呼ばれる付随処理 (通知など) を待つ
    const got = [...new Set(calls)];
    if (emits > before) got.push('emit');
    return got.sort();
  }

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('#1 画面から打つ通常メッセージ (socket) — 4 つ全部', async () => {
    const s = await new Promise<ClientSocket>((resolve) => {
      const c = Client(`http://localhost:${port}`, { auth: { token: human.token }, transports: ['websocket'] });
      c.on('connect', () => { c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
    });
    try {
      expect(await run(async () => { s.emit('message:send', { room_id: roomId, content: URL_TEXT }); })).toEqual(['emit', 'preview', 'push', 'webhook']);
    } finally { s.close(); }
  });

  it('#3 通常のメディアアップロード (人) — emit + push。③ は意図して無し (docs/07 §3.1)、④ は不明 (§3.2)', async () => {
    expect(await run(() => request(app).post(`/api/rooms/${roomId}/media`).set(auth(human.token))
      .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' }))).toEqual(['emit', 'push']);
  });

  it('#3 通常のメディアアップロード (機械) — emit + machine (部屋の設定で鳴らすか決まる、#463)', async () => {
    expect(await run(() => request(app).post(`/api/rooms/${roomId}/media`).set(auth(bot.token))
      .attach('files', PNG, { filename: 'b.png', contentType: 'image/png' }))).toEqual(['emit', 'machine']);
  });

  it('#5 Bot API のテキスト投稿 (postAsUser) — emit + machine + webhook。④ は不明 (§3.2)', async () => {
    expect(await run(() => request(app).post('/api/bot/push').set(auth(bot.token))
      .send({ room_id: roomId, content: URL_TEXT }))).toEqual(['emit', 'machine', 'webhook']);
  });

  it('#6 Bot API の画像投稿 — emit + machine。★ ③ は不明 (§3.2、60 日で影響 0 件・判断待ち)', async () => {
    expect(await run(() => request(app).post('/api/bot/push-image').set(auth(bot.token))
      .field('room_id', roomId).field('caption', URL_TEXT)
      .attach('image', PNG, { filename: 'c.png', contentType: 'image/png' }))).toEqual(['emit', 'machine']);
  });

  it('#7 Bot API のファイル投稿 — emit + machine。★ ③ は不明 (§3.2、#6 と同じ)', async () => {
    expect(await run(() => request(app).post('/api/bot/push-file').set(auth(bot.token))
      .field('room_id', roomId).field('content', URL_TEXT)
      .attach('file', Buffer.from('hello'), { filename: 'd.txt', contentType: 'text/plain' }))).toEqual(['emit', 'machine']);
  });

  it('#8 音声メッセージ (人) — emit + push + webhook。④ は不明 (§3.2)', async () => {
    expect(await run(() => request(app).post(`/api/rooms/${roomId}/voice`).set(auth(human.token))
      .attach('voice', Buffer.from('RIFF0000WAVEfmt '), { filename: 'v.wav', contentType: 'audio/wav' }))).toEqual(['emit', 'push', 'webhook']);
  });

  it('#8 音声メッセージ (機械) — emit + machine + webhook', async () => {
    expect(await run(() => request(app).post(`/api/rooms/${roomId}/voice`).set(auth(bot.token))
      .attach('voice', Buffer.from('RIFF0000WAVEfmt '), { filename: 'w.wav', contentType: 'audio/wav' }))).toEqual(['emit', 'machine', 'webhook']);
  });

  it('#9 REST の新規メッセージ — 4 つとも無し。★ ① は不明 (§3.2、14 日間呼ばれた回数 0)', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/messages`).set(auth(human.token)).send({ content: URL_TEXT });
    expect(res.status).toBe(201);
    expect(await run(async () => {})).toEqual([]);
    // ★ run の外で投稿したので、付随処理が後から来ていないかを改めて見る
    expect(calls).toEqual([]);
  });
});
