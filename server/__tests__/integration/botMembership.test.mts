/**
 * /api/bot の口と、スタンプ作成の投稿先は、その部屋のメンバーだけ (2026-09-30)
 * ★ /api/bot はログインしていれば誰でも呼べる (ボット専用ではない)。部屋を指定する口は入口で確かめる
 * ★ 各項に「メンバーなら通る」を並べて置く
 */
const mockGenerate = jest.fn(async (..._a: unknown[]) => ({ stamps: [] as unknown[] }));
jest.mock('../../src/services/stamp/index.mts', () => ({
  generateStampPack: (...a: unknown[]) => mockGenerate(...a),
  saveStampFiles: jest.fn(),
  checkDailyLimit: jest.fn(async () => 0),
}));

import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('/api/bot と スタンプ — 部屋の口はメンバーだけ', () => {
  let member: { id: string; token: string };
  let outsider: { id: string; token: string };
  let roomId: string;
  let msgId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    mockGenerate.mockClear();
    const m = await createTestUser({ login_id: 'EMP201', display_name: 'メンバー' });
    const o = await createTestUser({ login_id: 'EMP202', display_name: '部外者' });
    const w = await createTestUser({ login_id: 'EMP203', display_name: '書いた人' });
    member = { id: m.user.id, token: m.token };
    outsider = { id: o.user.id, token: o.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${m.token}`)
      .send({ name: '非公開の部屋', member_ids: [w.user.id] })).body.room.id;
    msgId = (await getTestPool().query<{ id: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, '内緒の話', 'text') RETURNING id`,
      [roomId, w.user.id])).rows[0].id;
  });

  const cursor = async (userId: string) =>
    (await getTestPool().query('SELECT 1 FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomId, userId])).rows.length;

  describe('GET /api/bot/unread?room_id=', () => {
    it('メンバーなら未読が読める', async () => {
      const res = await request(app).get(`/api/bot/unread?room_id=${roomId}`).set('Authorization', `Bearer ${member.token}`);
      expect(res.status).toBe(200);
      expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(['内緒の話']);
    });

    it('★ メンバーでなければ 403 (中身を返さない)', async () => {
      const res = await request(app).get(`/api/bot/unread?room_id=${roomId}`).set('Authorization', `Bearer ${outsider.token}`);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('内緒の話');
    });
  });

  describe('POST /api/bot/mark-read', () => {
    it('メンバーなら既読位置が進む', async () => {
      const res = await request(app).post('/api/bot/mark-read').set('Authorization', `Bearer ${member.token}`).send({ message_ids: [msgId] });
      expect(res.status).toBe(200);
      expect(await cursor(member.id)).toBe(1);
    });

    it('★ メンバーでない部屋の既読位置は書かない', async () => {
      const res = await request(app).post('/api/bot/mark-read').set('Authorization', `Bearer ${outsider.token}`).send({ message_ids: [msgId] });
      expect(res.status).toBe(200);
      expect(await cursor(outsider.id)).toBe(0);
    });
  });

  describe('POST /api/bot/status', () => {
    it('メンバーなら流せる', async () => {
      const res = await request(app).post('/api/bot/status').set('Authorization', `Bearer ${member.token}`)
        .send({ room_id: roomId, status: 'thinking' });
      expect(res.status).toBe(200);
    });

    it('★ メンバーでなければ 403', async () => {
      const res = await request(app).post('/api/bot/status').set('Authorization', `Bearer ${outsider.token}`)
        .send({ room_id: roomId, status: 'thinking' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/stamps/generate の room_id', () => {
    it('メンバーの部屋なら受け付ける', async () => {
      const res = await request(app).post('/api/stamps/generate').set('Authorization', `Bearer ${member.token}`)
        .send({ prompt: 'ねこ', room_id: roomId });
      expect(res.status).toBe(202);
    });

    it('部屋を指定しなければ受け付ける (投稿先なし)', async () => {
      const res = await request(app).post('/api/stamps/generate').set('Authorization', `Bearer ${outsider.token}`)
        .send({ prompt: 'ねこ' });
      expect(res.status).toBe(202);
    });

    it('★ メンバーでない部屋を指定したら 403 (生成も始めない)', async () => {
      const res = await request(app).post('/api/stamps/generate').set('Authorization', `Bearer ${outsider.token}`)
        .send({ prompt: 'ねこ', room_id: roomId });
      expect(res.status).toBe(403);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });
});
