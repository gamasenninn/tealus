/**
 * #6 ボットの画像 / #7 ボットのファイル: 送る中身を固定する (#383 段階 1 の試し、2026-10-01)
 *
 * ★ 段階 0 (postingPathSideEffects) は付随処理が「呼ばれたか」しか見ない。
 *   付随処理を announcePost へ移すとき、**送る中身**が黙って変わっても捕まらないので、移す前にここで固定する
 * ★ このテストは移す前のコードで通ることを先に確かめ、移した後も同じまま通ること
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

describe('#6 #7 ボットの画像・ファイル: 送る中身', () => {
  let port: number;
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
    const h = await createTestUser({ login_id: 'EMP701', display_name: '人' });
    const b = await createTestUser({ login_id: 'BOT701', display_name: 'ボット' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '中身の部屋', member_ids: [b.user.id] })).body.room.id;
    watcher = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: h.token }, transports: ['websocket'] });
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

  /** 配信された中身のうち、毎回変わらない部分 */
  const stable = (m: Record<string, unknown>) => {
    const media = (m.media as Array<Record<string, unknown>>).map((x) => ({
      file_name: x.file_name, mime_type: x.mime_type, file_size: x.file_size, width: x.width, height: x.height,
      has_thumbnail: !!x.thumbnail_path, message_id_matches: x.message_id === m.id,
    }));
    return {
      keys: Object.keys(m).sort(),
      // ★ ID は実行のたびに変わるので、記録 (スナップショット) には入れず一致だけ見る
      room_matches: m.room_id === roomId, sender_matches: m.sender_id === bot.id, content: m.content, type: m.type,
      sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url, media,
    };
  };

  it('#6 画像 (説明なし): 配信の中身・機械の通知の中身が今のまま。人の通知・AI 通知・プレビューは無し', async () => {
    const res = await request(app).post('/api/bot/push-image').set('Authorization', `Bearer ${bot.token}`)
      .field('room_id', roomId).attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0])).toMatchSnapshot();
    expect(recorded.machine).toEqual([{ roomId, senderId: bot.id, senderName: 'ボット', messageId: res.body.message.id, body: '📷 写真' }]);
    expect(recorded.push).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
    expect(Object.keys(res.body).sort()).toEqual(['media', 'message']);
  });

  it('#6 画像 (説明あり): 通知の本文は説明の先頭 100 字', async () => {
    const caption = 'あ'.repeat(120);
    const res = await request(app).post('/api/bot/push-image').set('Authorization', `Bearer ${bot.token}`)
      .field('room_id', roomId).field('content', caption).attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    await settle();
    expect(stable(emitted[0])).toMatchSnapshot();
    expect(emitted[0].content).toBe(caption); // ★ 説明は本文として入る (説明なしと区別できていることを確かめる)
    expect((recorded.machine[0] as { body: string }).body).toBe('あ'.repeat(100));
  });

  it('#7 ファイル (本文なし): 通知の本文は「📎 ファイル名」', async () => {
    const res = await request(app).post('/api/bot/push-file').set('Authorization', `Bearer ${bot.token}`)
      .field('room_id', roomId).attach('file', Buffer.from('hello'), { filename: 'd.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    await settle();
    expect(emitted).toHaveLength(1);
    expect(stable(emitted[0])).toMatchSnapshot();
    expect(recorded.machine).toEqual([{ roomId, senderId: bot.id, senderName: 'ボット', messageId: res.body.message.id, body: '📎 d.txt' }]);
    expect(recorded.push).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
  });

  it('#7 ファイル (本文あり): 通知の本文は本文の先頭 100 字', async () => {
    const res = await request(app).post('/api/bot/push-file').set('Authorization', `Bearer ${bot.token}`)
      .field('room_id', roomId).field('content', '  報告書です  ').attach('file', Buffer.from('x'), { filename: 'e.txt', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    await settle();
    expect(stable(emitted[0])).toMatchSnapshot();
    expect((recorded.machine[0] as { body: string }).body).toBe('報告書です');
  });
});
