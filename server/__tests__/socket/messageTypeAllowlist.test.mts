/**
 * 投稿の種類 (`type`) を口ごとに限る (2026-10-02、#483 の続きで利用者判断)
 *
 * ★ 本番の使われ方 (2026-10-02 実測) に合わせる:
 *   - 画面からの投稿 (socket message:send) … text だけ (画面は type を送らない)
 *   - REST の新規メッセージ … text と stamp (画面のスタンプだけがこの口)
 *   - ボットの投稿 (/api/bot/push) … text と form (フォームはボットだけが作る)
 * ★ system は 3 つの口のどれからも作れない (入退室・通話などはサーバの中の正規の口で作る)。
 *   form も人の口からは作れない (フォームへの返信は回答として扱われるため)
 * ★ 狙いは人の悪意より、ボットの口を叩く AI が変な種類を混ぜる間違いを止めること
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

jest.mock('../../src/services/push.mts', () => ({ ...jest.requireActual('../../src/services/push.mts'), sendPushToRoomMembers: jest.fn(async () => {}) }));
jest.mock('../../src/services/machinePush.mts', () => ({ ...jest.requireActual('../../src/services/machinePush.mts'), pushMachinePost: jest.fn(async () => {}) }));
jest.mock('../../src/services/webhook.mts', () => ({ ...jest.requireActual('../../src/services/webhook.mts'), fireWebhooks: jest.fn() }));
jest.mock('../../src/services/linkPreview.mts', () => ({ ...jest.requireActual('../../src/services/linkPreview.mts'), processLinkPreviews: jest.fn(async () => {}) }));

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe('投稿の種類を口ごとに限る', () => {
  let port: number;
  let human: { id: string; token: string };
  let bot: { id: string; token: string };
  let roomId: string;
  let stampId: string;
  let sock: ClientSocket;

  const count = async (type: string) => (await getTestPool().query<{ n: number }>(
    'SELECT count(*)::int n FROM messages WHERE room_id = $1 AND type = $2', [roomId, type])).rows[0].n;

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const h = await createTestUser({ login_id: 'EMP881', display_name: '人' });
    const b = await createTestUser({ login_id: 'BOT881', display_name: 'ボット' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [b.user.id]);
    human = { id: h.user.id, token: h.token };
    bot = { id: b.user.id, token: b.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${h.token}`)
      .send({ name: '種類の部屋', member_ids: [b.user.id] })).body.room.id;
    const pack = (await getTestPool().query<{ id: string }>(`INSERT INTO stamp_packs (name, created_by) VALUES ('束', $1) RETURNING id`, [h.user.id])).rows[0].id;
    stampId = (await getTestPool().query<{ id: string }>(`INSERT INTO stamps (pack_id, file_path, label) VALUES ($1, 'stamps/p/0.png', 'a') RETURNING id`, [pack])).rows[0].id;
    sock = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: h.token }, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  });
  afterAll(async () => { sock?.close(); appServer.close(); await closeTestDb(); });

  describe('画面からの投稿 (socket)', () => {
    const send = async (extra: Record<string, unknown>) => {
      sock.emit('message:send', { room_id: roomId, content: '本文', ...extra });
      await new Promise((r) => setTimeout(r, 300));
    };
    it('type を付けない (text) は通る', async () => {
      const before = await count('text');
      await send({});
      expect(await count('text')).toBe(before + 1);
    });
    it.each(['system', 'form', 'stamp', 'image', 'x'])('★ %s は断る', async (type) => {
      const before = await count(type);
      await send({ type });
      expect(await count(type)).toBe(before);
    });
  });

  describe('REST の新規メッセージ', () => {
    const send = (body: Record<string, unknown>) => request(app).post(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${human.token}`).send({ content: '本文', ...body });
    it('text と stamp は通る', async () => {
      expect((await send({})).status).toBe(201);
      expect((await send({ content: stampId, type: 'stamp' })).status).toBe(201);
    });
    it.each(['system', 'form', 'image', 'x'])('★ %s は 400 で、投稿は増えない', async (type) => {
      const before = await count(type);
      expect((await send({ type })).status).toBe(400);
      expect(await count(type)).toBe(before);
    });
  });

  describe('ボットの投稿 (/api/bot/push)', () => {
    const send = (body: Record<string, unknown>) => request(app).post('/api/bot/push')
      .set('Authorization', `Bearer ${bot.token}`).send({ room_id: roomId, content: '本文', ...body });
    it('text と form は通る', async () => {
      expect((await send({})).status).toBe(201);
      expect((await send({ type: 'form', content: JSON.stringify({ title: 'f', fields: [] }) })).status).toBe(201);
    });
    it.each(['system', 'stamp', 'image', 'x'])('★ %s は 400 で、投稿は増えない', async (type) => {
      const before = await count(type);
      expect((await send({ type })).status).toBe(400);
      expect(await count(type)).toBe(before);
    });
  });
});
