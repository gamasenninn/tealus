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

  // ★ 2 周目 (2026-09-29): クエリ・本文の room_id も同じ。get_messages / search_messages に
  //   「f3ee3f54...」を渡すと 500 だった
  const BAD = 'f3ee3f54...';
  const roomCases: Array<[string, string, Record<string, unknown> | null]> = [
    ['GET', `/api/bot/messages?room_id=${BAD}`, null],
    ['GET', `/api/bot/search?q=x&room_id=${BAD}`, null],
    ['GET', `/api/bot/tags?room_id=${BAD}`, null],
    ['GET', `/api/bot/unread?room_id=${BAD}`, null],
    ['POST', '/api/bot/mark-read', { room_id: BAD }],
    ['POST', '/api/bot/push', { room_id: BAD, content: 'x' }],
    ['POST', '/api/bot/status', { room_id: BAD, status: 'idle' }],
    ['POST', '/api/bot/tts-speak', { room_id: BAD, text: 'x' }],
  ];

  test.each(roomCases)('★ %s %s (崩れた room_id) は 400', async (method, url, body) => {
    const agent = request(app);
    const req = method === 'GET' ? agent.get(url) : agent.post(url);
    const res = await req.set('Authorization', `Bearer ${botToken}`).send(body ?? {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(BAD);
    expect(res.body.error).toContain('省略');
  });

  test.each([
    ['/api/bot/push-image', 'image', 'a.png'],
    ['/api/bot/push-file', 'file', 'a.txt'],
    ['/api/bot/tts-audio', 'audio', 'a.wav'],
  ])('★ ファイルを送る %s も、崩れた room_id は 400 (本文は道具の中で読み込まれる)', async (url, field, name) => {
    const res = await request(app).post(url).set('Authorization', `Bearer ${botToken}`)
      .field('room_id', BAD).attach(field, Buffer.from('x'), name);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(BAD);
  });

  test('★ 画面側の API の部屋の入口 (requireMember) も、崩れた部屋の ID は 400', async () => {
    const user = await createTestUser({ login_id: 'EMP001', display_name: '田中太郎' });
    const res = await request(app).get(`/api/rooms/${BAD}/messages`).set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(BAD);
  });

  test('形の合っている ID は今までどおり先へ進む (無い投稿なら 404)', async () => {
    const res = await request(app).get('/api/bot/messages/00000000-0000-0000-0000-000000000000/media?index=0')
      .set('Authorization', `Bearer ${botToken}`);
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(500);
  });
});
