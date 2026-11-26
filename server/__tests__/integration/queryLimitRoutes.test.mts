/**
 * #664 の 1: 件数の指定 (limit / offset) に数でない値・負の数を渡しても 500 にしない。
 * ★ 直す前は、お知らせは parseInt の結果 (NaN) を、ギャラリー・タグ一覧は負の数をそのまま SQL に渡して落ちていた
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

describe('件数の指定がおかしくても 500 にしない (#664)', () => {
  let owner: TestUser, roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    owner = await createTestUser({ login_id: 'EMP664', display_name: '件数' });
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '朝礼', member_ids: [] })).body.room.id;
    const pool = getTestPool();
    await pool.query('UPDATE rooms SET is_announcement = true WHERE id = $1', [roomId]);
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO messages (room_id, sender_id, content, type, is_published) VALUES ($1, $2, $3, 'text', true)`,
        [roomId, owner.user.id, `お知らせ ${i}`]);
    }
  });

  const get = (url: string) => request(app).get(url).set('Authorization', `Bearer ${owner.token}`);

  test.each(['abc', '-5', '0'])('お知らせ limit=%s は 200 で、1 件以上返す', async (limit) => {
    const res = await get(`/api/rooms/announcements?limit=${limit}`);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeGreaterThan(0);
  });

  test('お知らせ limit=1 は 1 件 (正しい値はそのまま効く)', async () => {
    const res = await get('/api/rooms/announcements?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  test.each([['-5', '0'], ['abc', 'abc'], ['10', '-3']])('ギャラリー limit=%s offset=%s は 200', async (limit, offset) => {
    const res = await get(`/api/rooms/${roomId}/media/gallery?limit=${limit}&offset=${offset}`);
    expect(res.status).toBe(200);
  });

  test.each(['-5', 'abc'])('タグ一覧 limit=%s は 200', async (limit) => {
    const res = await get(`/api/tags/all?limit=${limit}`);
    expect(res.status).toBe(200);
  });
});
