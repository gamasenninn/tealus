/**
 * #4 メディアの転送: 送る中身を固定する (#383 段階 1、2026-10-01)
 *
 * ★ 付随処理を announcePost へ移す前に、配信・人の通知・AI 通知の**中身**を固定する。移す前のコードで通ることを先に確かめる
 * ★ AI 通知には転送元 (`forwarded_from`) が入る。エージェントが読むので、形が変わったら落ちるようにする
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

import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('#4 メディアの転送: 送る中身', () => {
  let port: number;
  let human: { id: string; token: string };
  let roomA: string; // 転送元
  let roomB: string; // 転送先
  let watcher: ClientSocket;
  const emitted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP811', display_name: '転送する人' });
    const w = await createTestUser({ login_id: 'EMP812', display_name: '見ている人' });
    human = { id: h.user.id, token: h.token };
    roomA = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`).send({ name: '元', member_ids: [] })).body.room.id;
    roomB = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`).send({ name: '先', member_ids: [w.user.id] })).body.room.id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: w.token }, transports: ['websocket'] });
      s.on('connect', () => { s.emit('room:join', roomB); setTimeout(() => resolve(s), 200); });
      s.on('connect_error', reject);
    });
    watcher.on('message:new', (m: Record<string, unknown>) => { emitted.push(m); });
  });
  afterAll(async () => { watcher?.close(); appServer.close(); await closeTestDb(); });

  const settle = async () => {
    for (let i = 0; i < 40 && emitted.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };

  it.each([
    ['画像', 'a.png', 'image/png', PNG, '📎 画像を転送', 'image'],
    ['ファイル', 'b.pdf', 'application/pdf', Buffer.from('%PDF-1.4'), '📎 ファイルを転送', 'file'],
  ])('%s の転送: 配信の中身 + 人の通知 + AI 通知 (転送元つき)。機械の通知・プレビューは無し', async (_l, name, mime, body, pushBody, type) => {
    const up = await request(app).post(`/api/rooms/${roomA}/media`).set('Authorization', `Bearer ${human.token}`)
      .attach('files', body, { filename: name, contentType: mime });
    expect(up.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    const srcId = up.body.message.id as string;

    emitted.length = 0;
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
    const res = await request(app).post(`/api/rooms/${roomB}/media/forward`).set('Authorization', `Bearer ${human.token}`).send({ source_message_id: srcId });
    expect(res.status).toBe(201);
    await settle();

    const m = emitted[0];
    expect(emitted).toHaveLength(1);
    expect({
      keys: Object.keys(m).sort(),
      room_matches: m.room_id === roomB, sender_matches: m.sender_id === human.id, content: m.content, type: m.type,
      forwarded_matches: m.forwarded_from === srcId,
      sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url,
      media: (m.media as Array<Record<string, unknown>>).map((x) => ({ file_name: x.file_name, mime_type: x.mime_type })),
    }).toMatchSnapshot();
    expect(recorded.push).toEqual([[roomB, human.id, { title: '転送する人', body: pushBody, data: { roomId: roomB, messageId: m.id } }]]);
    expect(recorded.webhook).toEqual([['message.created', roomB, {
      room: { id: roomB },
      message: { id: m.id, type, content: null, forwarded_from: srcId, sender: { id: human.id, display_name: '転送する人' } },
    }]]);
    expect(recorded.machine).toEqual([]);
    expect(recorded.preview).toEqual([]);
    expect(Object.keys(res.body)).toEqual(['message']);
  });
});
