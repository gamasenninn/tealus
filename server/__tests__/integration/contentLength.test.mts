/**
 * 本文の長さの上限 (セキュリティチェックループの K、2026-10-27)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { MAX_CONTENT_LENGTH } from '../../src/services/messageTypes.mts';

type T = Awaited<ReturnType<typeof createTestUser>>;

describe('本文の長さの上限', () => {
  let u: T, bot: T, roomId: string;
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    u = await createTestUser({ login_id: 'EMPK01', display_name: '投稿する人' });
    bot = await createTestUser({ login_id: 'BOTK01', display_name: '機械' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${u.token}`).send({ name: '部屋', member_ids: [bot.user.id] })).body.room.id;
  });

  const big = 'a'.repeat(MAX_CONTENT_LENGTH + 1);   // ★ 英字で試す (日本語だと受け取りの 100KB で先に 413 になる)
  const ok = 'あ'.repeat(25_000);   // ★ 本番の最長 (約 2 万字) は通る

  it('★ 投稿: 上限までは通り、超えたら 400', async () => {
    const post = (content: string) => request(app).post(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${u.token}`).send({ content });
    expect((await post(ok)).status).toBe(201);
    const res = await post(big);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/長すぎます/);
  });

  it('★ 編集も同じ上限', async () => {
    const m = (await request(app).post(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${u.token}`).send({ content: 'はじめ' })).body.message;
    const res = await request(app).put(`/api/rooms/${roomId}/messages/${m.id}`).set('Authorization', `Bearer ${u.token}`).send({ content: big });
    expect(res.status).toBe(400);
  });

  it('★ 機械の投稿も同じ上限', async () => {
    const res = await request(app).post('/api/bot/push').set('Authorization', `Bearer ${bot.token}`).send({ room_id: roomId, content: big });
    expect(res.status).toBe(400);
  });
});
