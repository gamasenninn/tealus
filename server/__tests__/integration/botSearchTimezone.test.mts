/**
 * AI の検索 (GET /api/bot/search) の since / until: 時間帯の無い日付はサーバーの時間帯 (APP_TIMEZONE) で読む
 * (2026-10-30 小野さん判断 8)
 *
 * ★ 以前は DB の時間帯 (UTC) で読まれ、「10 月の〜」を `since=2026-10-01 until=2026-11-01` で聞くと、
 *   10-01 の 0〜9 時 (日本時間) の便が抜け、11-01 の 0〜9 時の便が混ざった
 * ★ `Z` や `+00:00` を明示した値は、書いてあるとおりに読む (今までと同じ)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('AI の検索の日付の時間帯', () => {
  let botToken: string, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const bot = await createTestUser({ login_id: 'BOT001', display_name: 'Bot' });
    await getTestPool().query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    botToken = bot.token;
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${bot.token}`)
      .send({ name: '部屋', member_ids: [] })).body.room.id;
    const ins = (content: string, at: string) => getTestPool().query(
      `INSERT INTO messages (room_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, 'text', $4)`,
      [roomId, bot.user.id, content, at]);
    await ins('9月末の夜', '2026-09-30T23:30:00+09:00');
    await ins('10月1日の朝', '2026-10-01T08:00:00+09:00');   // = 09-30 23:00 UTC
    await ins('11月1日の朝', '2026-11-01T08:00:00+09:00');   // = 10-31 23:00 UTC
  });

  const search = (qs: string) => request(app).get(`/api/bot/search?room_id=${roomId}&${qs}`).set('Authorization', `Bearer ${botToken}`);
  const contents = (res: request.Response) => (res.body.results ?? res.body.messages ?? []).map((m: { content?: string; snippet?: string }) => m.content ?? m.snippet).sort();

  it('★★ 時間帯の無い日付は日本時間で読む (10 月 = 10-01 0:00〜11-01 0:00 JST)', async () => {
    const res = await search('since=2026-10-01T00:00:00&until=2026-10-31T23:59:59');
    expect(res.status).toBe(200);
    expect(contents(res)).toEqual(['10月1日の朝']);
  });

  it('★ 日付だけ (2026-10-01) も日本時間の 0 時', async () => {
    const res = await search('since=2026-10-01&until=2026-11-01');
    expect(contents(res)).toEqual(['10月1日の朝']);
  });

  it('時間帯を明示した値は書いてあるとおり (+00:00 は UTC)', async () => {
    const res = await search(`since=${encodeURIComponent('2026-10-01T00:00:00+00:00')}&until=${encodeURIComponent('2026-11-01T00:00:00+00:00')}`);
    expect(contents(res)).toEqual(['11月1日の朝']);
  });
});
