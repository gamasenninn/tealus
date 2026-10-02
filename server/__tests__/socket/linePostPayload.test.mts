/**
 * #13〜#18 LINE からの投稿: 送る中身を固定する (#383 段階 1、2026-10-02)
 *
 * ★ 付随処理を announcePost へ移す前に、配信・通知・プレビューの**中身**を固定する。移す前のコードで通ることを先に確かめる
 * ★ AI 通知は**付けない** (docs/05 の不変条件。LINE の投稿で @cc-* を起動しない) —— 呼ばれたら落ちる
 * ★ 順番: 移す前の #13 は「プレビュー → 通知」だった。移して入口の順「通知 → プレビュー」に揃えた (2026-10-02 利用者判断)。移した後の順を固定する
 * ★ 位置 (postLocationToTealus) は #13 テキストを通る
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

const order: string[] = [];
const recorded: { machine: unknown[]; push: unknown[]; webhook: unknown[]; preview: unknown[] } = { machine: [], push: [], webhook: [], preview: [] };
jest.mock('../../src/services/machinePush.mts', () => {
  const actual = jest.requireActual('../../src/services/machinePush.mts');
  return { ...actual, pushMachinePost: jest.fn(async (post: unknown) => { recorded.machine.push(post); }) };
});
jest.mock('../../src/services/push.mts', () => {
  const actual = jest.requireActual('../../src/services/push.mts');
  return { ...actual, sendPushToRoomMembers: jest.fn(async (...a: unknown[]) => { order.push('push'); recorded.push.push(a); }) };
});
jest.mock('../../src/services/webhook.mts', () => {
  const actual = jest.requireActual('../../src/services/webhook.mts');
  return { ...actual, fireWebhooks: jest.fn((...a: unknown[]) => { recorded.webhook.push(a); }) };
});
jest.mock('../../src/services/linkPreview.mts', () => {
  const actual = jest.requireActual('../../src/services/linkPreview.mts');
  // ★ io は 3 つ目の引数。中身は比べず「渡っているか」だけを記録する
  return { ...actual, processLinkPreviews: jest.fn(async (id: unknown, text: unknown, io: unknown, room: unknown) => {
    order.push('preview'); recorded.preview.push([id, text, io != null, room]);
  }) };
});
// ★ 音声は文字起こしが裏で走って外へ出る。付随処理 4 つの外なので差し替えるだけ
jest.mock('../../src/services/transcription.mts', () => {
  const actual = jest.requireActual('../../src/services/transcription.mts');
  return { ...actual, transcribeVoiceMessage: jest.fn(async () => {}) };
});

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';
import { getIo } from '../../src/io-registry.mts';
import {
  postTextToTealus, postImageToTealus, postImagesToTealus, postVoiceToTealus, postFileToTealus, postVideoToTealus, postLocationToTealus,
} from '../../src/services/lineMessageBridge.mts';

/** 1x1 の PNG (サムネイル生成が通る本物の画像) */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('#13〜#18 LINE からの投稿: 送る中身', () => {
  let port: number;
  let sender: { id: string; display_name: string; avatar_url: null };
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
    const s = await createTestUser({ login_id: 'EMP841', display_name: 'LINE の人' });
    const w = await createTestUser({ login_id: 'EMP842', display_name: '読む人' });
    sender = { id: s.user.id, display_name: 'LINE の人 (LINE)', avatar_url: null };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${s.token}`)
      .send({ name: 'LINE の部屋', member_ids: [w.user.id] })).body.room.id;
    parentId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '返信される元の投稿', 'text') RETURNING id`, [roomId, w.user.id])).rows[0].id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const c = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      c.on('connect', () => { c.emit('room:join', roomId); setTimeout(() => resolve(c), 200); });
      c.on('connect_error', reject);
    });
    watcher.on('message:new', (m: Record<string, unknown>) => { emitted.push(m); });
  });
  afterAll(async () => { watcher?.close(); appServer.close(); await closeTestDb(); });

  beforeEach(() => {
    emitted.length = 0;
    order.length = 0;
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
  });

  const settle = async () => {
    for (let i = 0; i < 40 && emitted.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };

  const savedLine = (name: string, body: Buffer, mimeType: string) => {
    const root = process.env.MEDIA_ROOT!;
    const rel = `line-files/${Date.now()}-${name}`;
    fs.mkdirSync(path.join(root, 'line-files'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    return { filePath: path.join(root, rel), relativePath: rel, fileName: name, fileSize: body.length, mimeType };
  };

  /** 配信の中身。ID は一致を見たうえで伏せる */
  const stable = (m: Record<string, unknown>) => ({
    keys: Object.keys(m).sort(),
    room_matches: m.room_id === roomId, sender_matches: m.sender_id === sender.id, content: m.content, type: m.type,
    reply_to_matches: m.reply_to === null || m.reply_to === parentId, reply_to_is_null: m.reply_to === null,
    sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url,
    media: (m.media as Array<Record<string, unknown>> | undefined)?.map((x) => ({
      keys: Object.keys(x).sort(), file_name: x.file_name, mime_type: x.mime_type, file_size: x.file_size,
      has_thumbnail: x.thumbnail_path != null, width: x.width, height: x.height,
    })) ?? null,
  });

  const io = () => getIo();

  it.each([
    ['#13 テキスト (URL・返信あり)', () => postTextToTealus({ roomId, sender, content: '  見て https://example.com/a  ', replyTo: parentId, io: io() })],
    ['#13 テキスト (101 字以上)', () => postTextToTealus({ roomId, sender, content: 'あ'.repeat(120), io: io() })],
    ['#13 位置 (テキストを通る)', () => postLocationToTealus({ roomId, sender, location: { title: '本社', address: '栃木県', latitude: 36.5, longitude: 139.7 }, senderLabel: '送り手', io: io() })],
  ] as const)('%s: 配信 + 人の通知 + プレビュー。AI 通知は無し', async (_l, act) => {
    const { message } = await act();
    await settle();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe(message.id);
    expect(stable(emitted[0])).toMatchSnapshot('配信');
    const content = message.content as string;
    expect(recorded.push).toEqual([[roomId, sender.id, { title: 'LINE の人 (LINE)', body: content.slice(0, 100), data: { roomId, messageId: message.id } }]]);
    expect(recorded.preview).toEqual([[message.id, content, true, roomId]]);
    expect(recorded.machine).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(order).toEqual(['push', 'preview']);
  });

  it.each([
    ['#14 画像', () => postImageToTealus({ roomId, sender, mediaInfo: savedLine('a.png', PNG, 'image/png'), content: '[送り手]', io: io() })],
    ['#15 複数画像', () => postImagesToTealus({ roomId, sender, mediaInfos: [savedLine('b.png', PNG, 'image/png'), savedLine('c.png', PNG, 'image/png')], content: '[送り手]', io: io() })],
    ['#16 音声', () => postVoiceToTealus({ roomId, sender, mediaInfo: savedLine('v.m4a', Buffer.from('x'), 'audio/m4a'), content: '[送り手]', io: io() })],
    ['#17 ファイル', () => postFileToTealus({ roomId, sender, mediaInfo: savedLine('f.pdf', Buffer.from('%PDF-1.4'), 'application/pdf'), content: '[送り手]', io: io() })],
    ['#18 動画', () => postVideoToTealus({ roomId, sender, mediaInfo: savedLine('m.mp4', Buffer.from('x'), 'video/mp4'), content: '[送り手]', io: io() })],
  ] as const)('%s: 配信 + 機械の通知。AI 通知・プレビューは無し', async (_l, act) => {
    const { message } = await act() as { message: { id: string } };
    await settle();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe(message.id);
    expect(stable(emitted[0])).toMatchSnapshot('配信');
    expect(recorded.machine).toHaveLength(1);
    const post = recorded.machine[0] as Record<string, unknown>;
    expect({ ...post, roomId: post.roomId === roomId, senderId: post.senderId === sender.id, messageId: post.messageId === message.id }).toMatchSnapshot('機械の通知');
    expect(recorded.push).toEqual([]);
    expect(recorded.preview).toEqual([]);
    expect(recorded.webhook).toEqual([]);
  });
});
