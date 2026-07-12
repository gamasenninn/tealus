/**
 * 統合テスト: JWT 認証ミドルウェア
 */
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';

// ミドルウェア load 前に JWT_SECRET を固定（dev fallback と同期を取るため）
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const JWT_SECRET = process.env.JWT_SECRET;

// Express app を使ってテスト
import request from 'supertest';
import express from 'express';
// ESM では import が (jest.mock 巻き上げと同様に) 巻き上げられ評価される。static import だと
// middleware/auth.mts の module-load 時 JWT_SECRET 解決が上記の env override より先に走ってしまう
// (dev fallback を掴んだまま固定される) ため、require で env override 後の遅延読込にする。
const { authenticate } = require('../../src/middleware/auth.mts') as { authenticate: RequestHandler };

let app: express.Express;

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.get('/protected', authenticate, (req, res) => {
    res.json({ user: (req as express.Request & { user?: unknown }).user });
  });
});

function makeToken(payload: object, secret: string = JWT_SECRET, options: jwt.SignOptions = {}): string {
  return jwt.sign(payload, secret, { expiresIn: '1h', ...options });
}

describe('JWT 認証ミドルウェア', () => {

  // --- 1. ヘッダーなし → 401 ---
  test('1. Authorization ヘッダーなし → 401', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('認証が必要');
  });

  // --- 2. 有効トークン → next + req.user ---
  test('2. Bearer + 有効トークン → 200 + req.user 設定', async () => {
    const token = makeToken({ id: 'user1', login_id: 'EMP001' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user1');
    expect(res.body.user.login_id).toBe('EMP001');
  });

  // --- 3. 無効トークン → 401 ---
  test('3. Bearer + 無効トークン → 401', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('トークンが無効');
  });

  // --- 4. 期限切れトークン → 401 ---
  test('4. Bearer + 期限切れトークン → 401', async () => {
    const token = makeToken({ id: 'user1' }, JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // --- 5. Bearer 後にトークンなし → 401 ---
  test('5. Bearer のみ（トークンなし）→ 401', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  // --- 6. 小文字 bearer → 401 ---
  test('6. 小文字 bearer → 401', async () => {
    const token = makeToken({ id: 'user1' });
    const res = await request(app).get('/protected').set('Authorization', `bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // --- 7. Token スキーム → 401 ---
  test('7. Token スキーム（Bearer 以外）→ 401', async () => {
    const token = makeToken({ id: 'user1' });
    const res = await request(app).get('/protected').set('Authorization', `Token ${token}`);
    expect(res.status).toBe(401);
  });

  // --- 8. req.user にペイロードが設定される ---
  test('8. req.user に id, login_id が含まれる', async () => {
    const token = makeToken({ id: 'uuid-123', login_id: 'EMP999' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.user).toHaveProperty('id', 'uuid-123');
    expect(res.body.user).toHaveProperty('login_id', 'EMP999');
  });

  // --- 9. 別の JWT_SECRET → 401 ---
  test('9. 別の SECRET で署名されたトークン → 401', async () => {
    const token = makeToken({ id: 'user1' }, 'wrong-secret');
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
