/**
 * #3 通常のメディアアップロード: 送る中身を固定する (#383 段階 1、2026-10-01)
 *
 * ★ 付随処理を announcePost へ移す前に、配信・人の通知・機械の通知の**中身**を固定する
 *   (段階 0 は「呼ばれたか」しか見ない)。移す前のコードで通ることを先に確かめる
 * ★ 人と機械で通知の出し方が違う: 人 = sendPushToRoomMembers を待たずに投げる / 機械 = pushMachinePost を待つ
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

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('#3 メディアアップロード: 送る中身', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let watcher: ClientSocket;
  const emitted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP801', display_name: '人' });
    const b = await createTestUser({ login_id: 'BOT801', display_name: 'ボット' });
    const w = await createTestUser({ login_id: 'EMP802', display_name: '見ている人' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: 'アップロードの部屋', member_ids: [b.user.id, w.user.id] })).body.room.id;
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

  /** 配信された中身のうち、毎回変わらない部分 (ID は一致だけ見る) */
  const stable = (m: Record<string, unknown>, senderId: string) => ({
    keys: Object.keys(m).sort(),
    room_matches: m.room_id === roomId, sender_matches: m.sender_id === senderId, content: m.content, type: m.type,
    sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url,
    media: (m.media as Array<Record<string, unknown>>).map((x) => ({
      file_name: x.file_name, mime_type: x.mime_type, file_size: x.file_size, has_thumbnail: !!x.thumbnail_path, message_id_matches: x.message_id === m.id,
    })),
  });

  it('人が画像 1 枚: 配信の中身 + 人の通知 (📷 写真)。機械の通知・AI 通知・プレビューは無し', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${human.token}`)
      .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0], human.id)).toMatchSnapshot();
    expect(recorded.push).toEqual([[roomId, human.id, { title: '人', body: '📷 写真', data: { roomId, messageId: res.body.message.id } }]]);
    expect(recorded.machine).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
    expect(Object.keys(res.body).sort()).toMatchSnapshot();
  });

  it('人が画像 2 枚: 通知の本文は「📷 写真 (2 件)」', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${human.token}`)
      .attach('files', PNG, { filename: 'b.png', contentType: 'image/png' })
      .attach('files', PNG, { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    await settle();
    expect(stable(emitted[0], human.id)).toMatchSnapshot();
    expect((recorded.push[0] as unknown[])[2]).toEqual({ title: '人', body: '📷 写真 (2 件)', data: { roomId, messageId: res.body.message.id } });
  });

  it('人がファイル 1 つ: 通知の本文は「📎 ファイル」', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${human.token}`)
      .attach('files', Buffer.from('%PDF-1.4'), { filename: 'd.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    await settle();
    expect(stable(emitted[0], human.id)).toMatchSnapshot();
    expect((recorded.push[0] as unknown[])[2]).toEqual({ title: '人', body: '📎 ファイル', data: { roomId, messageId: res.body.message.id } });
  });

  it('機械が画像 1 枚: 配信の中身 + 機械の通知 (📷 写真)。人の通知は無し', async () => {
    const res = await request(app).post(`/api/rooms/${roomId}/media`).set('Authorization', `Bearer ${bot.token}`)
      .attach('files', PNG, { filename: 'e.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    await settle();
    expect(stable(emitted[0], bot.id)).toMatchSnapshot();
    expect(recorded.machine).toEqual([{ roomId, senderId: bot.id, senderName: 'ボット', messageId: res.body.message.id, body: '📷 写真' }]);
    expect(recorded.push).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
  });
});
