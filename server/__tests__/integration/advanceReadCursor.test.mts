/**
 * 既読の位置を進める処理を 1 つに (改善ループ 69、#649 B-3)
 *
 * ★ 同じ 10 行の UPSERT が 4 か所 (画面の既読・すべて既読・Bot の既読・socket の既読) に写してあり、
 *   #553 で「すべて既読」の 1 か所だけ GREATEST が無く、別の端末と競合すると未読が戻りえた
 */
import fs from 'node:fs';
import path from 'node:path';
import { advanceReadCursor } from '../../src/services/readCounts.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

describe('advanceReadCursor', () => {
  let userId: string, roomId: string;
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP001', display_name: '読む人' });
    userId = u.user.id;
    const r = await getTestPool().query<{ id: string }>(`INSERT INTO rooms (name, type, created_by) VALUES ('部屋', 'group', $1) RETURNING id`, [userId]);
    roomId = r.rows[0].id;
    await getTestPool().query('INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)', [roomId, userId]);
  });

  async function msg(at: string): Promise<{ id: string; created_at: string }> {
    const r = await getTestPool().query<{ id: string; created_at: string }>(
      `INSERT INTO messages (room_id, sender_id, content, type, created_at) VALUES ($1, $2, 'x', 'text', $3) RETURNING id, created_at`,
      [roomId, userId, at]);
    return r.rows[0];
  }
  const cursor = async () => (await getTestPool().query('SELECT last_read_message_id FROM room_read_cursors WHERE room_id = $1 AND user_id = $2', [roomId, userId])).rows[0]?.last_read_message_id;

  it('初めてなら作る・新しい便なら進める', async () => {
    const a = await msg('2026-11-18T01:00:00Z');
    const b = await msg('2026-11-18T02:00:00Z');
    await advanceReadCursor(getTestPool(), roomId, userId, a.id, a.created_at);
    expect(await cursor()).toBe(a.id);
    await advanceReadCursor(getTestPool(), roomId, userId, b.id, b.created_at);
    expect(await cursor()).toBe(b.id);
  });

  it('★ 古い便では戻さない (別の端末がより先まで読んでいた)', async () => {
    const a = await msg('2026-11-18T01:00:00Z');
    const b = await msg('2026-11-18T02:00:00Z');
    await advanceReadCursor(getTestPool(), roomId, userId, b.id, b.created_at);
    await advanceReadCursor(getTestPool(), roomId, userId, a.id, a.created_at);
    expect(await cursor()).toBe(b.id);
  });

  it('★ 既読を進める 4 か所は、すべてこの関数を使う (同じ SQL を手で写さない)', () => {
    const SRC = path.join(import.meta.dirname, '../../src');
    for (const rel of ['routes/read.mts', 'routes/bot.mts', 'socket/handlers/read.mts']) {
      const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect([rel, /INSERT INTO room_read_cursors/.test(text)]).toEqual([rel, false]);
      expect([rel, /advanceReadCursor\(/.test(text)]).toEqual([rel, true]);
    }
  });
});
