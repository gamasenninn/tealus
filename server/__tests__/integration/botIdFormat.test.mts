/**
 * bot の API: 形の崩れた ID に 500 でなく 400 を返す (2026-09-29 システムチェック)
 *
 * ★ 会話モードの AI が、投稿の ID を「754...」と省略して get_message_media に渡した。
 *   本体は ID の形を確かめずに DB に投げ、500 (invalid input syntax for type uuid) を返していた。
 *   #477 (部屋の ID の写し間違い) と同じ種類。AI が読んで直せるよう、400 と「省略せずに渡して」を返す。
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('bot の API — ID の形を確かめる', () => {
  let botToken: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const bot = await createTestUser({ login_id: 'BOT001', display_name: 'Tealus Bot' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    botToken = bot.token;
  });

  const cases: Array<[string, string]> = [
    ['GET', '/api/bot/messages/754.../media?index=0'],
    ['POST', '/api/bot/messages/754.../transcribe'],
    ['GET', '/api/bot/messages/754.../edit-history'],
    ['PATCH', '/api/bot/messages/754.../tags/TODO/done'],
    ['POST', '/api/bot/rooms/754.../join'],
    ['GET', '/api/bot/rooms/754.../membership'],
  ];

  test.each(cases)('★ %s %s は 400 で、省略せずに渡すよう返す', async (method, url) => {
    const agent = request(app);
    const req = method === 'GET' ? agent.get(url) : method === 'POST' ? agent.post(url) : agent.patch(url);
    const res = await req.set('Authorization', `Bearer ${botToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('754...');
    expect(res.body.error).toContain('省略');
  });

  test('形の合っている ID は今までどおり先へ進む (無い投稿なら 404)', async () => {
    const res = await request(app).get('/api/bot/messages/00000000-0000-0000-0000-000000000000/media?index=0')
      .set('Authorization', `Bearer ${botToken}`);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(500);
  });
});
