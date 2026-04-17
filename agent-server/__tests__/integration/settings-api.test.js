/**
 * 統合テスト: 設定 API ルート
 * Supertest で実際の HTTP リクエストを検証。
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'tealus-dev-secret';

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/context/settingsManager', () => ({
  getAllSettings: jest.fn(() => ({ tool_tavily: true, max_turns: 3 })),
  saveSettings: jest.fn(),
  loadSettings: jest.fn(),
  getSetting: jest.fn((k, d) => d),
}));

jest.mock('../../src/lib/botApi', () => ({
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

jest.mock('../../src/mcp/roomMcpManager', () => ({
  invalidateRoomMcp: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/config', () => ({
  WORKSPACE_ROOT: require('os').tmpdir(),
}));

// app を構築
const express = require('express');
const cors = require('cors');
const { authenticate } = require('../../src/middleware/auth');
const settingsRoutes = require('../../src/routes/settings');

let app;
const token = jwt.sign({ id: 'admin1', employee_id: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use(cors());
  app.use('/config', authenticate, settingsRoutes);
});

describe('設定 API 統合テスト', () => {

  // --- 1. GET /config/settings ---
  test('1. GET /config/settings → 設定返却', async () => {
    const res = await request(app).get('/config/settings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings).toHaveProperty('tool_tavily', true);
  });

  // --- 2. PUT /config/settings 正常 ---
  test('2. PUT /config/settings 正常 → 保存成功', async () => {
    const { saveSettings } = require('../../src/context/settingsManager');
    const res = await request(app)
      .put('/config/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { max_turns: 5 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith({ max_turns: 5 });
  });

  // --- 3. PUT /config/settings 不正 ---
  test('3. PUT /config/settings 不正 → 400', async () => {
    const res = await request(app)
      .put('/config/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  // --- 4. GET /config/mcp ---
  test('4. GET /config/mcp → MCP 設定返却', async () => {
    const res = await request(app).get('/config/mcp').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('mcpConfig');
  });

  // --- 5. PUT /config/mcp 正常 ---
  test('5. PUT /config/mcp 正常 → 保存成功', async () => {
    const res = await request(app)
      .put('/config/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ mcpConfig: { mcpServers: {} } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --- 6. GET /config/env ---
  test('6. GET /config/env → 安全な項目のみ', async () => {
    const res = await request(app).get('/config/env').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('env');
    // API Key は含まれない
    expect(res.body.env).not.toHaveProperty('OPENAI_API_KEY');
  });

  // --- 7. GET /config/system-prompt ---
  test('7. GET /config/system-prompt → カスタム/デフォルト', async () => {
    const res = await request(app).get('/config/system-prompt').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('default');
    expect(res.body).toHaveProperty('isCustom');
  });

  // --- 8. PUT /config/system-prompt ---
  test('8. PUT /config/system-prompt → 保存', async () => {
    const res = await request(app)
      .put('/config/system-prompt')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'カスタムプロンプト' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --- 9. 認証なし → 401 ---
  test('9. 認証なしでアクセス → 401', async () => {
    const res = await request(app).get('/config/settings');
    expect(res.status).toBe(401);
  });

  // --- 10. GET /config/rooms ---
  test('10. GET /config/rooms → ルーム一覧', async () => {
    const res = await request(app).get('/config/rooms').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rooms');
  });

  // --- 11. GET /config/room/:id/settings ---
  test('11. GET /config/room/:id/settings → ルーム設定', async () => {
    const res = await request(app).get('/config/room/test-room/settings').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings).toHaveProperty('response_mode');
  });

  // --- 12. GET /config/room/:id/light-prompt ---
  test('12. GET /config/room/:id/light-prompt → Light プロンプト', async () => {
    const res = await request(app).get('/config/room/test-room/light-prompt').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('content');
  });
});
