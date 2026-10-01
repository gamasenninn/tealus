/**
 * #8 音声メッセージ: 送る中身を固定する (#383 段階 1、2026-10-01)
 *
 * ★ 付随処理を announcePost へ移す前に、配信・通知・AI 通知の**中身**を固定する。移す前のコードで通ることを先に確かめる
 * ★ AI 通知には返信先 (`reply_to` / `reply_to_message`) が入る。エージェントが読むので、形が変わったら落ちるようにする
 * ★ 順番は固定しない: 移すと「AI 通知 → 通知」が「通知 → AI 通知」に変わる (利用者判断で許容、docs/07 §5.1)
 */
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
  return { ...actual, fireWebhooks: jest.fn((...a: unknown[]) => { recorded.webhook.push(a); }) };
});
jest.mock('../../src/services/linkPreview.mts', () => {
  const actual = jest.requireActual('../../src/services/linkPreview.mts');
  return { ...actual, processLinkPreviews: jest.fn(async (...a: unknown[]) => { recorded.preview.push(a); }) };
});
// ★ 文字起こしは裏で走って外へ出る。付随処理 4 つの外なので差し替えるだけ
jest.mock('../../src/services/transcription.mts', () => {
  const actual = jest.requireActual('../../src/services/transcription.mts');
  return { ...actual, transcribeVoiceMessage: jest.fn(async () => {}) };
});

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

const WAV = Buffer.from('RIFF0000WAVEfmt ');

describe('#8 音声メッセージ: 送る中身', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let parentId: string;
  let watcher: ClientSocket;
  const emitted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP821', display_name: '話す人' });
    const b = await createTestUser({ login_id: 'BOT821', display_name: '話すボット' });
    const w = await createTestUser({ login_id: 'EMP822', display_name: '聞く人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '音声の部屋', member_ids: [b.user.id, w.user.id] })).body.room.id;
    parentId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '返信される元の投稿', 'text') RETURNING id`, [roomId, w.user.id])).rows[0].id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      s.on('connect', () => { s.emit('room:join', roomId); setTimeout(() => resolve(s), 200); });
      s.on('connect_error', reject);
    });
    watcher.on('message:new', (m: Record<string, unknown>) => { emitted.push(m); });
  });
  afterAll(async () => { watcher?.close(); appServer.close(); await closeTestDb(); });

  beforeEach(() => {
    emitted.length = 0;
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
  });

  const settle = async () => {
    for (let i = 0; i < 40 && emitted.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };

  const stable = (m: Record<string, unknown>, senderId: string) => {
    const r = m.reply_to_message as Record<string, unknown> | null;
    return {
      keys: Object.keys(m).sort(),
      room_matches: m.room_id === roomId, sender_matches: m.sender_id === senderId, content: m.content, type: m.type,
      reply_to_matches: m.reply_to === (r ? parentId : null),
      sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url,
      media: (m.media as Array<Record<string, unknown>>).map((x) => ({ mime_type: x.mime_type, file_size: x.file_size })),
      reply_to_message: r ? { keys: Object.keys(r).sort(), id_matches: r.id === parentId, content: r.content } : null,
    };
  };

  /** AI 通知の中身。ID は一致を見たうえで記録用に伏せる */
  const webhookShape = (args: unknown[], messageId: string, senderId: string) => {
    const [event, room, payload] = args as [string, string, { room: { id: string }; message: Record<string, unknown> }];
    expect(event).toBe('message.created');
    expect(room).toBe(roomId);
    expect(payload.room).toEqual({ id: roomId });
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

  it.each([
    ['人・返信なし', false, false],
    ['人・返信あり', false, true],
    ['機械・返信なし', true, false],
  ])('%s: 配信 + 通知 + AI 通知の中身。プレビューは無し', async (_l, isBot, withReply) => {
    const who = isBot ? bot : human;
    const req = request(app).post(`/api/rooms/${roomId}/voice`).set('Authorization', `Bearer ${who.token}`);
    if (withReply) req.field('reply_to', parentId);
    const res = await req.attach('voice', WAV, { filename: 'v.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(201);
    await settle();
    const id = res.body.message.id as string;

    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0], who.id)).toMatchSnapshot();
    expect(recorded.webhook).toHaveLength(1);
    expect(webhookShape(recorded.webhook[0] as unknown[], id, who.id)).toMatchSnapshot();
    if (isBot) {
      expect(recorded.machine).toEqual([{ roomId, senderId: bot.id, senderName: '話すボット', messageId: id, body: '🎤 音声メッセージ' }]);
      expect(recorded.push).toEqual([]);
    } else {
      expect(recorded.push).toEqual([[roomId, human.id, { title: '話す人', body: '🎤 音声メッセージ', data: { roomId, messageId: id } }]]);
      expect(recorded.machine).toEqual([]);
    }
    expect(recorded.preview).toEqual([]);
    expect(Object.keys(res.body).sort()).toEqual(['media', 'message']);
  });
});
