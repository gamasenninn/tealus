/**
 * #1 画面から打つメッセージ (socket `message:send`): 送る中身を固定する (#383 段階 1、2026-10-02)
 *
 * ★ 付随処理を announcePost へ移す前に、配信・通知・AI 通知・プレビューの**中身と順番**を固定する。移す前のコードで通ることを先に確かめる
 * ★ いちばん多く使われる経路なので、形を変えやすい所を全部押さえる:
 *   - 返信 (`reply_to_message`) と転送 (`forwarded_from_message`) は配信の中身に入る
 *   - ★ 通知とプレビューは**空白を落とす前**の本文、配信 (DB) と AI 通知は**落とした後**の本文を使う (今の形のまま固定する)
 *   - プレビューは `type === 'text'` のときだけ (★ 2026-10-02 から socket は text 以外を断るので、text 以外の場合は messageTypeAllowlist で見る)
 *   - ★ 機械が socket から送っても通知は「人の通知」になる (今の形のまま固定する。#463 の機械の通知には乗らない)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

const order: string[] = [];
const recorded: { machine: unknown[]; push: unknown[]; webhook: unknown[]; preview: unknown[] } = { machine: [], push: [], webhook: [], preview: [] };
jest.mock('../../src/services/machinePush.mts', () => {
  const actual = jest.requireActual('../../src/services/machinePush.mts');
  return { ...actual, pushMachinePost: jest.fn(async (post: unknown) => { order.push('machine'); recorded.machine.push(post); }) };
});
jest.mock('../../src/services/push.mts', () => {
  const actual = jest.requireActual('../../src/services/push.mts');
  return { ...actual, sendPushToRoomMembers: jest.fn(async (...a: unknown[]) => { order.push('push'); recorded.push.push(a); }) };
});
jest.mock('../../src/services/webhook.mts', () => {
  const actual = jest.requireActual('../../src/services/webhook.mts');
  return { ...actual, fireWebhooks: jest.fn((...a: unknown[]) => { order.push('webhook'); recorded.webhook.push(a); }) };
});
jest.mock('../../src/services/linkPreview.mts', () => {
  const actual = jest.requireActual('../../src/services/linkPreview.mts');
  // ★ io は 3 つ目の引数。中身は比べず「渡っているか」だけを記録する
  return { ...actual, processLinkPreviews: jest.fn(async (id: unknown, text: unknown, io: unknown, room: unknown) => {
    order.push('preview'); recorded.preview.push([id, text, io != null, room]);
  }) };
});

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { server as appServer, app } from '../../src/app.mts';

describe('#1 画面から打つメッセージ: 送る中身', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let otherRoomId: string;
  let parentId: string;
  let forwardSrcId: string;
  let watcher: ClientSocket;
  const senders: Record<string, ClientSocket> = {};
  const emitted: Array<Record<string, unknown>> = [];

  const connect = (token: string) => new Promise<ClientSocket>((resolve, reject) => {
    const s = Client(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => { s.emit('room:join', roomId); setTimeout(() => resolve(s), 200); });
    s.on('connect_error', reject);
  });

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP831', display_name: '打つ人' });
    const b = await createTestUser({ login_id: 'BOT831', display_name: '打つボット' });
    const w = await createTestUser({ login_id: 'EMP832', display_name: '読む人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '打つ部屋', member_ids: [b.user.id, w.user.id] })).body.room.id;
    otherRoomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '転送元の部屋', member_ids: [w.user.id] })).body.room.id;
    parentId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '返信される元の投稿', 'text') RETURNING id`, [roomId, w.user.id])).rows[0].id;
    forwardSrcId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '転送される元の投稿', 'text') RETURNING id`, [otherRoomId, w.user.id])).rows[0].id;
    watcher = await connect(w.token);
    watcher.on('message:new', (m: Record<string, unknown>) => { emitted.push(m); order.push('emit'); });
    senders.human = await connect(h.token);
    senders.bot = await connect(b.token);
  });
  afterAll(async () => {
    watcher?.close();
    for (const s of Object.values(senders)) s.close();
    appServer.close();
    await closeTestDb();
  });

  beforeEach(() => {
    emitted.length = 0;
    order.length = 0;
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
  });

  const settle = async () => {
    for (let i = 0; i < 40 && emitted.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };

  /** 配信の中身。ID は一致を見たうえで伏せる */
  const stable = (m: Record<string, unknown>, senderId: string) => {
    const r = m.reply_to_message as Record<string, unknown> | null;
    const f = m.forwarded_from_message as Record<string, unknown> | null;
    return {
      keys: Object.keys(m).sort(),
      room_matches: m.room_id === roomId, sender_matches: m.sender_id === senderId, content: m.content, type: m.type,
      reply_to_matches: m.reply_to === (r ? parentId : null),
      forwarded_from_matches: m.forwarded_from === (f ? forwardSrcId : null),
      sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url,
      reply_to_message: r ? { keys: Object.keys(r).sort(), id_matches: r.id === parentId, content: r.content, type: r.type, sender_display_name: r.sender_display_name } : null,
      forwarded_from_message: f ? { keys: Object.keys(f).sort(), id_matches: f.id === forwardSrcId, content: f.content, room_name: f.room_name, room_type: f.room_type, is_deleted: f.is_deleted } : null,
    };
  };

  /** AI 通知の中身。ID は一致を見たうえで伏せる */
  const webhookShape = (args: unknown[], messageId: string, senderId: string) => {
    const [event, room, payload] = args as [string, string, { room: { id: string }; message: Record<string, unknown> }];
    expect(event).toBe('message.created');
    expect(room).toBe(roomId);
    expect(payload).toEqual({ room: { id: roomId }, message: expect.any(Object) });
    expect(payload.message.id).toBe(messageId);
    expect((payload.message.sender as { id: string }).id).toBe(senderId);
    const rtm = payload.message.reply_to_message as Record<string, unknown> | null;
    return {
      message_keys: Object.keys(payload.message).sort(),
      type: payload.message.type, content: payload.message.content,
      reply_to_matches: payload.message.reply_to === (rtm ? parentId : null),
      reply_to_message: rtm ? { keys: Object.keys(rtm).sort(), id_matches: rtm.id === parentId, content: rtm.content } : null,
      sender_display_name: (payload.message.sender as { display_name: string }).display_name,
    };
  };

  const URL_TEXT = '  見てください https://example.com/a  ';

  it.each([
    ['人・テキスト', 'human', { content: 'こんにちは' }],
    ['人・前後に空白 + URL', 'human', { content: URL_TEXT }],
    ['人・返信あり', 'human', { content: '返信します', reply_to: 'PARENT' }],
    ['人・転送', 'human', { content: '転送される元の投稿', forwarded_from: 'FORWARD' }],
    ['機械が socket から送る', 'bot', { content: 'ボットです' }],
  ] as const)('%s', async (_l, who, input) => {
    const sender = who === 'bot' ? bot : human;
    const send: Record<string, unknown> = { room_id: roomId, ...input };
    if (send.reply_to === 'PARENT') send.reply_to = parentId;
    if (send.forwarded_from === 'FORWARD') send.forwarded_from = forwardSrcId;
    senders[who].emit('message:send', send);
    await settle();

    expect(emitted).toHaveLength(1);
    const id = emitted[0].id as string;
    expect(stable(emitted[0], sender.id)).toMatchSnapshot('配信');

    // ② 通知: 人の通知。本文は空白を落とす前の本文を 100 字で切ったもの
    expect(recorded.push).toEqual([[roomId, sender.id, {
      title: who === 'bot' ? '打つボット' : '打つ人',
      body: (input.content as string).slice(0, 100),
      data: { roomId, messageId: id },
    }]]);
    expect(recorded.machine).toEqual([]);

    // ③ AI 通知
    expect(recorded.webhook).toHaveLength(1);
    expect(webhookShape(recorded.webhook[0] as unknown[], id, sender.id)).toMatchSnapshot('AI 通知');

    // ④ プレビュー: type が text のときだけ。本文は空白を落とす前のもの
    const isText = ((input as { type?: string }).type ?? 'text') === 'text';
    expect(recorded.preview).toEqual(isText ? [[id, input.content, true, roomId]] : []);

    // 順番: 配信 → 通知 → AI 通知 → プレビュー (★ 配信は受け手に届いた時点で記録するので、送る側の順とは比べない)
    expect(order.filter((x) => x !== 'emit')).toEqual(isText ? ['push', 'webhook', 'preview'] : ['push', 'webhook']);
  });
});
