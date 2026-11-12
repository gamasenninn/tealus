/**
 * 鍵を使っている間に延ばす (2026-11-12 小野さん判断、docs/05 §5)
 * ★ 残りが半分を切った鍵で認証が通ったら、応答のヘッダー X-Refreshed-Token に新しい鍵を返す。
 *   最初のログインから 30 日は超えない (単体: __tests__/unit/tokenRefresh.test.mts)
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app.mts';
import { setupTestDb, cleanTestDb, closeTestDb } from '../helpers/db.mts';
import { createTestUser } from '../helpers/auth.mts';
import { JWT_SECRET } from '../../src/middleware/auth.mts';

const DAY = 24 * 60 * 60;
const tokenFor = (u: { id: string; login_id: string }, c: Record<string, number>) =>
  jwt.sign({ id: u.id, login_id: u.login_id, ...c }, JWT_SECRET);

describe('X-Refreshed-Token (使っている間に延ばす)', () => {
  beforeAll(async () => { await setupTestDb(); });
  afterAll(async () => { await closeTestDb(); });
  beforeEach(async () => { await cleanTestDb(); });

  it('★ 残りが 2 日の鍵なら新しい鍵が返り、その鍵で通る (新しい鍵では毎回は作り直さない)', async () => {
    const { user } = await createTestUser({ login_id: 'REF001', display_name: '延長太郎' });
    const now = Math.floor(Date.now() / 1000);
    const old = tokenFor(user, { iat: now - 5 * DAY, exp: now + 2 * DAY, auth_at: now - 5 * DAY });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${old}`);
    expect(res.status).toBe(200);
    const fresh = res.headers['x-refreshed-token'];
    expect(typeof fresh).toBe('string');

    const again = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${fresh}`);
    expect(again.status).toBe(200);
    expect(again.headers['x-refreshed-token']).toBeUndefined();
  });

  it('残りが多い鍵では返さない', async () => {
    const { token } = await createTestUser({ login_id: 'REF002', display_name: '延長花子' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-refreshed-token']).toBeUndefined();
  });

  it('★ 期限切れの鍵は今までどおり 401 (延ばさない)', async () => {
    const { user } = await createTestUser({ login_id: 'REF003', display_name: '延長次郎' });
    const now = Math.floor(Date.now() / 1000);
    const expired = tokenFor(user, { iat: now - 8 * DAY, exp: now - 60, auth_at: now - 8 * DAY });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.headers['x-refreshed-token']).toBeUndefined();
  });
});
