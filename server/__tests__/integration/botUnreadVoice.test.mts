/**
 * #664 の 6: bot の未読 (GET /api/bot/unread) で、音声の本文を文字起こしの最新版に差し替える。
 * ★ 以前は音声 1 件ごとに 1 回引いていた。/api/bot/messages (11-26 Q3) と同じく、まとめて 1 回で引く。中身は同じ
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { pool } from '../../src/db/pool.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('bot の未読の音声 (#664)', () => {
  let reader: { id: string; token: string };
  let roomId: string;
  const voiceIds: string[] = [];

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    voiceIds.length = 0;
    const r = await createTestUser({ login_id: 'EMP641', display_name: '読む人' });
    const w = await createTestUser({ login_id: 'EMP642', display_name: '話した人' });
    reader = { id: r.user.id, token: r.token };
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${r.token}`)
      .send({ name: '音声の部屋', member_ids: [w.user.id] })).body.room.id;
    const db = getTestPool();
    for (let i = 0; i < 3; i++) {
      voiceIds.push((await db.query<{ id: string }>(
        `INSERT INTO messages (room_id, sender_id, content, type) VALUES ($1, $2, NULL, 'voice') RETURNING id`,
        [roomId, w.user.id])).rows[0].id);
    }
    // 0: 整形あり (古い版と新しい版) / 1: 生だけ / 2: 文字起こし無し
    await db.query(
      `INSERT INTO voice_transcriptions (message_id, raw_text, formatted_text, status, version) VALUES
       ($1, '古い生', '古い整形', 'done', 1), ($1, '新しい生', '新しい整形', 'done', 2),
       ($2, '生だけ', NULL, 'done', 1)`,
      [voiceIds[0], voiceIds[1]]);
  });

  it('本文は最新版の整形 → 無ければ生 → 無ければ元のまま', async () => {
    const res = await request(app).get(`/api/bot/unread?room_id=${roomId}`).set('Authorization', `Bearer ${reader.token}`);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.messages.map((m: { id: string; content: string | null }) => [m.id, m.content]));
    expect(byId.get(voiceIds[0])).toBe('新しい整形');
    expect(byId.get(voiceIds[1])).toBe('生だけ');
    expect(byId.get(voiceIds[2])).toBeNull();
  });

  it('★ 文字起こしは音声が何件あっても 1 回の問い合わせで引く', async () => {
    const spy = jest.spyOn(pool, 'query');
    try {
      const res = await request(app).get(`/api/bot/unread?room_id=${roomId}`).set('Authorization', `Bearer ${reader.token}`);
      expect(res.status).toBe(200);
      const transQueries = spy.mock.calls.filter(([sql]) => typeof sql === 'string' && /FROM voice_transcriptions/.test(sql));
      expect(transQueries).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
