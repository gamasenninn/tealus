/**
 * #550 管理画面の「今日の応答数」「今週の応答数」を日本時間 (APP_TIMEZONE) の暦で数える。
 * ★ 以前は DB の CURRENT_DATE (UTC) で切っていて、「今日」が日本時間 9:00 から始まっていた
 *   (10-10 11:55 に 61 と出ていたが、日本時間で数えると 67)
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const H = 3_600_000;
/** 日本時間の今日 0:00 (UTC の Date) */
function jstMidnight(now = new Date()): Date {
  const j = new Date(now.getTime() + 9 * H);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 9 * H);
}

describe('GET /api/admin/agent-stats — 今日・今週は日本時間 (#550)', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  test('★ 日本時間の今日 0:30 は「今日」に入り、昨日 23:30 は入らない', async () => {
    await cleanTestDb();
    const admin = await createTestUser({ login_id: 'ADMIN550', display_name: '管理者' });
    const bot = await createTestUser({ login_id: 'BOT550', display_name: 'アシスタント' });
    const pool = getTestPool();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.user.id]);
    await pool.query('UPDATE users SET is_bot = true WHERE id = $1', [bot.user.id]);
    const roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '応答数の部屋', member_ids: [bot.user.id] })).body.room.id;

    const mid = jstMidnight();
    for (const at of [new Date(mid.getTime() + 0.5 * H), new Date(mid.getTime() - 0.5 * H)]) {
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type, created_at) VALUES ($1, $2, '応答', 'text', $3)`,
        [roomId, bot.user.id, at],
      );
    }

    const res = await request(app).get('/api/admin/agent-stats').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.stats.total_responses).toBe(2);
    expect(res.body.stats.today_responses).toBe(1);
  });
});
