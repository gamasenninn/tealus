/**
 * #482 返信先・転送元に指せる投稿を絞る (2026-10-02)
 *
 * ★ 返信先 (`reply_to`) は**投稿する部屋と同じ部屋の投稿**だけ (画面の返信は同じ部屋でしか作れない)
 * ★ 転送元 (`forwarded_from`) は**送り手がメンバーである部屋の投稿**だけ (画面の転送は自分の部屋から)
 * ★ 満たさなければ投稿ごと断る (利用者判断)。参照だけ外すと「返信」が単独の発言に変わるため
 * ★ 無い投稿と、読めない部屋の投稿は同じ扱い (区別して返さない)
 * 口: #1 socket message:send / #9 REST POST /messages / #8 音声 (返信先だけ)
 * ★ メディアの転送 (#4) は以前から転送元の部屋のメンバーかを確かめている (routes/media.mts)
 */
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';

// ★ 付随処理は外へ出るので差し替える (ここで見るのは「投稿ができたか」だけ)
jest.mock('../../src/services/push.mts', () => ({ ...jest.requireActual('../../src/services/push.mts'), sendPushToRoomMembers: jest.fn(async () => {}) }));
jest.mock('../../src/services/webhook.mts', () => ({ ...jest.requireActual('../../src/services/webhook.mts'), fireWebhooks: jest.fn() }));
jest.mock('../../src/services/linkPreview.mts', () => ({ ...jest.requireActual('../../src/services/linkPreview.mts'), processLinkPreviews: jest.fn(async () => {}) }));
jest.mock('../../src/services/transcription.mts', () => ({ ...jest.requireActual('../../src/services/transcription.mts'), transcribeVoiceMessage: jest.fn(async () => {}) }));

import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { app, server as appServer } from '../../src/app.mts';

const WAV = Buffer.from('RIFF0000WAVEfmt ');

describe('#482 返信先・転送元に指せる投稿', () => {
  let port: number;
  let a: { id: string; token: string };
  let r1: string; // ★ 投稿する部屋 (a はメンバー)
  let r2: string; // a はメンバー (別の部屋)
  let r3: string; // a はメンバーでない
  const msg: Record<'inR1' | 'inR2' | 'inR3', string> = { inR1: '', inR2: '', inR3: '' };
  let sock: ClientSocket;

  const post = async (room: string, sender: string, content: string) => (await getTestPool().query<{ id: string }>(
    `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, $3, 'text') RETURNING id`, [room, sender, content])).rows[0].id;
  const count = async (room: string) => (await getTestPool().query<{ n: number }>(
    'SELECT count(*)::int n FROM messages WHERE room_id = $1', [room])).rows[0].n;

  beforeAll(async () => {
    await setupTestDb();
    expect(process.env.DB_PORT).toBe('5433');
    await new Promise<void>((resolve) => {
      appServer.listen(0, () => { port = (appServer.address() as AddressInfo).port; resolve(); });
    });
    await cleanTestDb();
    const ua = await createTestUser({ login_id: 'EMP851', display_name: '送る人' });
    const ub = await createTestUser({ login_id: 'EMP852', display_name: '別の人' });
    a = { id: ua.user.id, token: ua.token };
    const mk = async (token: string, name: string, members: string[]) => (await request(app).post('/api/rooms')
      .set('Authorization', `Bearer ${token}`).send({ name, member_ids: members })).body.room.id as string;
    r1 = await mk(ua.token, '部屋 1', [ub.user.id]);
    r2 = await mk(ua.token, '部屋 2', [ub.user.id]);
    r3 = await mk(ub.token, '部屋 3 (送る人はいない)', []);
    msg.inR1 = await post(r1, ub.user.id, '部屋 1 の投稿');
    msg.inR2 = await post(r2, ub.user.id, '部屋 2 の投稿');
    msg.inR3 = await post(r3, ub.user.id, '部屋 3 の投稿');
    sock = await new Promise<ClientSocket>((resolve, reject) => {
      const s = Client(`http://localhost:${port}`, { auth: { token: a.token }, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  });
  afterAll(async () => { sock?.close(); appServer.close(); await closeTestDb(); });

  /** socket で送って、部屋 1 の投稿が増えたか */
  const viaSocket = async (extra: Record<string, unknown>) => {
    const before = await count(r1);
    sock.emit('message:send', { room_id: r1, content: '送ります', ...extra });
    await new Promise((r) => setTimeout(r, 300));
    return (await count(r1)) - before;
  };

  describe('#1 socket message:send', () => {
    it('同じ部屋の投稿への返信は通る', async () => { expect(await viaSocket({ reply_to: msg.inR1 })).toBe(1); });
    it('★ メンバーである別の部屋の投稿への返信は断る', async () => { expect(await viaSocket({ reply_to: msg.inR2 })).toBe(0); });
    it('★ メンバーでない部屋の投稿への返信は断る', async () => { expect(await viaSocket({ reply_to: msg.inR3 })).toBe(0); });
    it('★ 無い投稿への返信は断る', async () => { expect(await viaSocket({ reply_to: randomUUID() })).toBe(0); });
    it('★ ID の形でない返信先は断る', async () => { expect(await viaSocket({ reply_to: 'x' })).toBe(0); });
    it('メンバーである部屋の投稿の転送は通る', async () => { expect(await viaSocket({ forwarded_from: msg.inR2 })).toBe(1); });
    it('★ メンバーでない部屋の投稿の転送は断る', async () => { expect(await viaSocket({ forwarded_from: msg.inR3 })).toBe(0); });
    it('★ 無い投稿の転送は断る', async () => { expect(await viaSocket({ forwarded_from: randomUUID() })).toBe(0); });
    it('参照なしは通る', async () => { expect(await viaSocket({})).toBe(1); });
  });

  describe('#9 REST POST /api/rooms/:id/messages', () => {
    const send = (body: Record<string, unknown>) => request(app).post(`/api/rooms/${r1}/messages`)
      .set('Authorization', `Bearer ${a.token}`).send({ content: '送ります', ...body });
    it('同じ部屋の投稿への返信は 201', async () => { expect((await send({ reply_to: msg.inR1 })).status).toBe(201); });
    it('★ 別の部屋の投稿への返信は 403、投稿は増えない', async () => {
      const before = await count(r1);
      expect((await send({ reply_to: msg.inR2 })).status).toBe(403);
      expect((await send({ reply_to: msg.inR3 })).status).toBe(403);
      expect(await count(r1)).toBe(before);
    });
    it('★ 無い投稿と読めない部屋の投稿は同じ答え (区別しない)', async () => {
      const none = await send({ forwarded_from: randomUUID() });
      const other = await send({ forwarded_from: msg.inR3 });
      expect([none.status, none.body]).toEqual([other.status, other.body]);
      expect(other.status).toBe(403);
    });
    it('★ ID の形でない参照は 400', async () => {
      expect((await send({ reply_to: 'x' })).status).toBe(400);
      expect((await send({ forwarded_from: 'x' })).status).toBe(400);
    });
    it('メンバーである部屋の投稿の転送は 201', async () => { expect((await send({ forwarded_from: msg.inR2 })).status).toBe(201); });
  });

  describe('#8 音声 (返信先)', () => {
    const voice = (replyTo: string) => request(app).post(`/api/rooms/${r1}/voice`)
      .set('Authorization', `Bearer ${a.token}`).field('reply_to', replyTo)
      .attach('voice', WAV, { filename: 'v.wav', contentType: 'audio/wav' });
    it('同じ部屋の投稿への返信は 201', async () => { expect((await voice(msg.inR1)).status).toBe(201); });
    it('★ 別の部屋の投稿への返信は 403、投稿は増えない', async () => {
      const before = await count(r1);
      expect((await voice(msg.inR3)).status).toBe(403);
      expect((await voice(msg.inR2)).status).toBe(403);
      expect(await count(r1)).toBe(before);
    });
  });
});
