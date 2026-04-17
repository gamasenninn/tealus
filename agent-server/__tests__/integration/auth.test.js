/**
 * 統合テスト: JWT 認証ミドルウェア
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'tealus-dev-secret';

// Express app を使ってテスト
const request = require('supertest');
const express = require('express');
const { authenticate } = require('../../src/middleware/auth');

let app;

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.get('/protected', authenticate, (req, res) => {
    res.json({ user: req.user });
  });
});

function makeToken(payload, secret = JWT_SECRET, options = {}) {
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
    const token = makeToken({ id: 'user1', employee_id: 'EMP001' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user1');
    expect(res.body.user.employee_id).toBe('EMP001');
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
  test('8. req.user に id, employee_id が含まれる', async () => {
    const token = makeToken({ id: 'uuid-123', employee_id: 'EMP999' });
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.body.user).toHaveProperty('id', 'uuid-123');
    expect(res.body.user).toHaveProperty('employee_id', 'EMP999');
  });

  // --- 9. 別の JWT_SECRET → 401 ---
  test('9. 別の SECRET で署名されたトークン → 401', async () => {
    const token = makeToken({ id: 'user1' }, 'wrong-secret');
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
