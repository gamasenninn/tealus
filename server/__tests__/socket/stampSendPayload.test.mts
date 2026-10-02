/**
 * #9' スタンプを送る (REST POST /messages, type='stamp'): 配信 + 人の通知 (#383、2026-10-02 利用者判断)
 *
 * ★ 画面はスタンプを REST で送る (MessageInput の sendStamp)。REST の口には配信も通知も無く、
 *   **送った本人の画面にしか出ず、ほかの人には開き直すまで届かなかった** (2026-10-02 の本番確認で見つけた)
 * ★ 付けるのは ① 配信 と ② 人の通知。③ AI 通知・④ プレビューは付けない (スタンプで AI は動かさない)
 * ★ 配信の中身は履歴 (attachStamps) と同じく `stamp` (file_path / label …) を載せる。画面はこれで絵を描く
 * ★ REST のテキスト (type が stamp 以外) は今までどおり何も付けない (#9、利用者判断で触らない)
 */
import type { AddressInfo } from 'node:net';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

const recorded: { machine: unknown[]; push: unknown[]; webhook: unknown[]; preview: unknown[] } = { machine: [], push: [], webhook: [], preview: [] };
jest.mock('../../src/services/machinePush.mts', () => ({ ...jest.requireActual('../../src/services/machinePush.mts'), pushMachinePost: jest.fn(async (p: unknown) => { recorded.machine.push(p); }) }));
jest.mock('../../src/services/push.mts', () => ({ ...jest.requireActual('../../src/services/push.mts'), sendPushToRoomMembers: jest.fn(async (...a: unknown[]) => { recorded.push.push(a); }) }));
jest.mock('../../src/services/webhook.mts', () => ({ ...jest.requireActual('../../src/services/webhook.mts'), fireWebhooks: jest.fn((...a: unknown[]) => { recorded.webhook.push(a); }) }));
jest.mock('../../src/services/linkPreview.mts', () => ({ ...jest.requireActual('../../src/services/linkPreview.mts'), processLinkPreviews: jest.fn(async (...a: unknown[]) => { recorded.preview.push(a); }) }));

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

describe("#9' スタンプを送る: 送る中身", () => {
  let port: number;
  let sender: { id: string; token: string };
  let roomId: string;
  let stampId: string;
  let watcher: ClientSocket;
  const emitted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const s = await createTestUser({ login_id: 'EMP861', display_name: 'スタンプの人' });
    const w = await createTestUser({ login_id: 'EMP862', display_name: '見る人' });
    sender = { id: s.user.id, token: s.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${s.token}`)
      .send({ name: 'スタンプの部屋', member_ids: [w.user.id] })).body.room.id;
    const pack = (await getTestPool().query<{ id: string }>(
      `INSERT INTO stamp_packs (name, created_by) VALUES ('テストの束', $1) RETURNING id`, [s.user.id])).rows[0].id;
    stampId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO stamps (pack_id, file_path, label) VALUES ($1, 'stamps/x/0.png', 'よろしく') RETURNING id`, [pack])).rows[0].id;
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
    for (const k of Object.keys(recorded) as Array<keyof typeof recorded>) recorded[k].length = 0;
  });

  const settle = async () => {
    for (let i = 0; i < 40 && emitted.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 100));
  };
  const send = (body: Record<string, unknown>) => request(app).post(`/api/rooms/${roomId}/messages`)
    .set('Authorization', `Bearer ${sender.token}`).send(body);

  it('★ スタンプは ほかの人に配信され (絵の情報つき)、人の通知が鳴る。AI 通知・プレビューは無し', async () => {
    const res = await send({ content: stampId, type: 'stamp' });
    expect(res.status).toBe(201);
    await settle();
    const id = res.body.message.id as string;

    expect(emitted).toHaveLength(1);
    const m = emitted[0];
    expect(m.id).toBe(id);
    expect({ type: m.type, content: m.content === stampId, sender_display_name: m.sender_display_name, sender_avatar_url: m.sender_avatar_url })
      .toEqual({ type: 'stamp', content: true, sender_display_name: 'スタンプの人', sender_avatar_url: null });
    expect(m.stamp).toEqual(expect.objectContaining({ id: stampId, file_path: 'stamps/x/0.png', label: 'よろしく', pack_name: 'テストの束' }));

    expect(recorded.push).toEqual([[roomId, sender.id, { title: 'スタンプの人', body: '🙂 スタンプ', data: { roomId, messageId: id } }]]);
    expect(recorded.machine).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
  });

  it('★ REST のテキスト (stamp 以外) は今までどおり何も付けない (#9 は触らない)', async () => {
    const res = await send({ content: 'REST のテキスト https://example.com' });
    expect(res.status).toBe(201);
    await settle();
    expect(emitted).toEqual([]);
    expect(recorded.push).toEqual([]);
    expect(recorded.webhook).toEqual([]);
    expect(recorded.preview).toEqual([]);
  });
});
