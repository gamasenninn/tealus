/**
 * 画面側のメッセージの口: 形の崩れたメッセージ ID に 500 でなく 400 と理由を返す (2026-10-01)
 * ★ #477 / botIdFormat と同じ決まり。9/29 に「様子を見る」とした残りのうち、メッセージの口を揃える
 */
import request from 'supertest';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';

const BAD = '754e-not-a-uuid';

describe('メッセージの口: 崩れた ID は 400', () => {
  let token: string;
  let roomId: string;

  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });

  beforeEach(async () => {
    await cleanTestDb();
    const u = await createTestUser({ login_id: 'EMP401', display_name: '利用者' });
    token = u.token;
    roomId = (await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`)
      .send({ name: 'R', member_ids: [] })).body.room.id;
  });

  it.each([
    ['PATCH', `/${BAD}/publish`, { published: true }],
    ['PUT', `/${BAD}`, { content: 'x' }],
    ['GET', `/${BAD}/edits`, null],
    ['DELETE', `/${BAD}`, null],
    ['POST', `/${BAD}/reactions`, { emoji: '✅' }],
  ])('★ %s %s は 400 と理由', async (method, sub, body) => {
    const url = `/api/rooms/${roomId}/messages${sub}`;
    const r = request(app)[(method as string).toLowerCase() as 'get'](url).set('Authorization', `Bearer ${token}`);
    const res = body ? await r.send(body) : await r;
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(BAD);
  });
});
