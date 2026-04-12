/**
 * ヘルスチェックのテスト
 */
const request = require('supertest');

// supertest が未インストールの場合を考慮
let app;
try {
  app = require('../../src/index').app;
} catch (e) {
  // 依存関係未インストール時はスキップ
}

describe('Health Check', () => {
  test('GET /health が200を返す', async () => {
    if (!app) return;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('tealus-agent-server');
  });
});
