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
 * ★ 対象: docs/07 §2 の 18 本すべて (#12' を含む)。LINE (#13〜#18) は受信の署名を作らず、関数を直接呼ぶ
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
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

// ★ スタンプは画像生成が外へ出る。完成と失敗を切り替えられるように差し替える
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
import { getIo } from '../../src/io-registry.mts';
import * as capabilityWatcher from '../../src/services/capabilityWatcher.mts';
import { activeCalls } from '../../src/socket/handlers/call.mts';
import {
  postTextToTealus, postImageToTealus, postImagesToTealus, postVoiceToTealus, postFileToTealus, postVideoToTealus,
} from '../../src/services/lineMessageBridge.mts';

/** 1x1 の PNG (サムネイル生成が通る本物の画像) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const URL_TEXT = 'リンク https://example.com/x';

describe('投稿経路ごとの付随処理 (docs/07 の表)', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let room2: string; // ★ #12' ボットが自分で入る部屋 (ボットはまだメンバーでない)
  let other: { id: string; token: string };
  let rtc: http.Server;
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
    const o = await createTestUser({ login_id: 'EMP603', display_name: '招かれる人' });
    other = { id: o.user.id, token: o.token };
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '経路の部屋', member_ids: [b.user.id, w.user.id] })).body.room.id;
    room2 = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: 'ボットが入る部屋', member_ids: [w.user.id] })).body.room.id;
    // ★ 通話は「通話サーバが動いている」ときしか受け付けない。手元に健康確認の口を立てる
    rtc = http.createServer((_q, r) => { r.statusCode = 200; r.end('ok'); });
    await new Promise<void>((r) => rtc.listen(0, '127.0.0.1', r));
    process.env.RTC_PORT = String((rtc.address() as AddressInfo).port);
    await capabilityWatcher.checkAndEmit();
    activeCalls.clear();
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      s.on('connect', () => { s.emit('room:join', roomId); s.emit('room:join', room2); setTimeout(() => resolve(s), 200); });
      s.on('connect_error', reject);
    });
    watcher.on('message:new', () => { emits++; });
  });
  afterAll(async () => {
    watcher?.close();
    capabilityWatcher.stop();
    delete process.env.RTC_PORT;
    rtc?.close();
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

  // ===== 2 周目: system メッセージ・転送・LINE =====

  const humanSocket = () => new Promise<ClientSocket>((resolve) => {
    const c = Client(`http://localhost:${port}`, { auth: { token: human.token }, transports: ['websocket'] });
    c.on('connect', () => { c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
  });

  it('#2 通話の開始・終了 (system) — emit だけ。②③④ は意図して無し (§3.1「通話でエージェントが動くのは誤り」)', async () => {
    const s = await humanSocket();
    try {
      expect(await run(async () => { s.emit('call:start', { roomId }); })).toEqual(['emit']);
      expect(await run(async () => { s.emit('call:end', { roomId }); })).toEqual(['emit']);
    } finally { s.close(); }
  });

  it('#4 メディアの転送 — emit + push + webhook。④ は不明 (§3.2)', async () => {
    // ★ 転送できるのはメディアのメッセージ。転送元は別の部屋に、run の外で上げておく (その分の付随処理は数えない)
    const up = await request(app).post(`/api/rooms/${room2}/media`).set(auth(human.token))
      .attach('files', PNG, { filename: 'src.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));
    const src = up.body.message.id as string;
    let status = 0;
    expect(await run(async () => {
      status = (await request(app).post(`/api/rooms/${roomId}/media/forward`).set(auth(human.token))
        .send({ source_message_id: src })).status;
    })).toEqual(['emit', 'push', 'webhook']);
    expect(status).toBe(201);
  });

  it('#10 スタンプの完成 (system) — emit だけ (§3.1)', async () => {
    stampMode.fail = false;
    expect(await run(() => request(app).post('/api/stamps/generate').set(auth(human.token))
      .send({ prompt: 'ねこ', room_id: roomId }))).toEqual(['emit']);
  });

  it('#11 スタンプの失敗 (system) — emit だけ (§3.1)', async () => {
    stampMode.fail = true;
    try {
      expect(await run(() => request(app).post('/api/stamps/generate').set(auth(human.token))
        .send({ prompt: 'いぬ', room_id: roomId }))).toEqual(['emit']);
    } finally { stampMode.fail = false; }
  });

  it('#12 入退室 (system、人の招待) — emit だけ (§3.1)', async () => {
    expect(await run(() => request(app).post(`/api/rooms/${roomId}/members`).set(auth(human.token))
      .send({ user_id: other.id }))).toEqual(['emit']);
  });

  it("#12' ボットが自分で入る (system) — emit だけ (§3.1)", async () => {
    expect(await run(() => request(app).post(`/api/bot/rooms/${room2}/join`).set(auth(bot.token)))).toEqual(['emit']);
  });

  /** LINE の受け取ったファイルを、メディアの置き場 (テストでは一時フォルダ) に置く */
  const savedLine = (name: string, body: Buffer, mimeType: string) => {
    const root = process.env.MEDIA_ROOT!;
    const rel = `line-files/${Date.now()}-${name}`;
    fs.mkdirSync(path.join(root, 'line-files'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    return { filePath: path.join(root, rel), relativePath: rel, fileName: name, fileSize: body.length, mimeType };
  };
  const lineSender = () => ({ id: human.id, display_name: '人 (LINE)', avatar_url: null });

  it('#13 LINE のテキスト — emit + push + preview。③ は意図して無し (§3.1、LINE で @cc-* を起動しない)', async () => {
    expect(await run(() => postTextToTealus({ roomId, sender: lineSender(), content: URL_TEXT, io: getIo() }))).toEqual(['emit', 'preview', 'push']);
  });

  it('#14 LINE の画像 — emit + machine (§3.1、#463 ルームの管理者が選ぶ)', async () => {
    expect(await run(() => postImageToTealus({ roomId, sender: lineSender(), mediaInfo: savedLine('a.png', PNG, 'image/png'), io: getIo() }))).toEqual(['emit', 'machine']);
  });

  it('#15 LINE の複数画像 — emit + machine', async () => {
    expect(await run(() => postImagesToTealus({ roomId, sender: lineSender(), mediaInfos: [savedLine('b.png', PNG, 'image/png'), savedLine('c.png', PNG, 'image/png')], io: getIo() }))).toEqual(['emit', 'machine']);
  });

  it('#16 LINE の音声 — emit + machine', async () => {
    expect(await run(() => postVoiceToTealus({ roomId, sender: lineSender(), mediaInfo: savedLine('v.m4a', Buffer.from('x'), 'audio/m4a'), io: getIo() }))).toEqual(['emit', 'machine']);
  });

  it('#17 LINE のファイル — emit + machine', async () => {
    expect(await run(() => postFileToTealus({ roomId, sender: lineSender(), mediaInfo: savedLine('f.pdf', Buffer.from('%PDF-1.4'), 'application/pdf'), io: getIo() }))).toEqual(['emit', 'machine']);
  });

  it('#18 LINE の動画 — emit + machine', async () => {
    expect(await run(() => postVideoToTealus({ roomId, sender: lineSender(), mediaInfo: savedLine('m.mp4', Buffer.from('x'), 'video/mp4'), io: getIo() }))).toEqual(['emit', 'machine']);
  });
});
