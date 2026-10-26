/**
 * 統合テスト: 設定 API ルート
 * Supertest で実際の HTTP リクエストを検証。
 *
 * Test isolation: AGENT_CONFIG_DIR / AGENT_MCP_CONFIG_PATH を tmpDir に向けて、
 * 本番 config/system_prompt.md / mcp_config.json を触らないように隔離する
 * (#235、本番 file 上書き事故の予防)。
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express, { type Express } from 'express';
import cors from 'cors';

// **重要**: 下記 require より先に env を設定する必要がある (require 時に const 化される)
const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-api-test-'));
const tmpMcpPath = path.join(tmpConfigDir, 'mcp_config.json');
process.env.AGENT_CONFIG_DIR = tmpConfigDir;
process.env.AGENT_MCP_CONFIG_PATH = tmpMcpPath;

afterAll(() => {
  delete process.env.AGENT_CONFIG_DIR;
  delete process.env.AGENT_MCP_CONFIG_PATH;
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const JWT_SECRET = process.env.JWT_SECRET;

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

jest.mock('../../src/context/settingsManager.mts', () => ({
  getAllSettings: jest.fn(() => ({ tool_tavily: true, max_turns: 3 })),
  saveSettings: jest.fn(),
  loadSettings: jest.fn(),
  getSetting: jest.fn((k: string, d: unknown) => d),
}));

jest.mock('../../src/lib/botApi.mts', () => ({
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

jest.mock('../../src/mcp/roomMcpManager.mts', () => ({
  invalidateRoomMcp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/config.mts', () => ({
  WORKSPACE_ROOT: require('node:os').tmpdir(),
}));

// app を構築
// 注: authenticate / settingsRoutes は env (AGENT_CONFIG_DIR / JWT_SECRET) 設定より先に
// module 読込されると const 化された値がずれる (auth.mts の JWT_SECRET fallback、
// routes/settings.mts の CONFIG_DIR)。static import は ESM hoisting で env 設定行より
// 先に評価されてしまうため、意図的に require() で env 設定後の位置に留める。
const { authenticate } = require('../../src/middleware/auth');
const { router: settingsRoutes } = require('../../src/routes/settings');

let app: Express;
const token = jwt.sign({ id: 'admin1', login_id: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

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
    // ★ #590 今の経路で効いていない項目と理由 (画面がグレーアウトに使う)。config に経路が無ければ既定の v2
    expect(Object.keys(res.body.inactive)).toContain('tool_tavily');
    expect(res.body.light_backend).toBe('v2');
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

/**
 * G-1 (2026-10-27) ★★ ルームの設定 4 つの置き場は workspace の外 `<WORKSPACE_ROOT>/_room-configs/<agentId>/<roomId>/`。
 *   workspace (= AI が書ける場所) には書かない・そこからは読まない (旧にしか無ければ 1 度だけ移す)。
 *   WORKSPACE_ROOT は上のモックで os.tmpdir()、agentId は bot-uuid。
 */
describe('G-1 ルームの設定は workspace の外に置く', () => {
  const { roomConfigPath } = require('../../src/lib/roomConfigPaths.mts') as typeof import('../../src/lib/roomConfigPaths.mts');
  const ROOT = os.tmpdir();
  const room = `g1-room-${process.pid}-${Date.now()}`;
  const ws = path.join(ROOT, 'bot-uuid', room);
  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(path.dirname(roomConfigPath(ws, 'CLAUDE.md')), { recursive: true, force: true });
  });

  test('★★ PUT light-prompt / claude-md / settings / mcp は _room-configs に書き、workspace には何も置かない', async () => {
    const h = { Authorization: `Bearer ${token}` };
    expect((await request(app).put(`/config/room/${room}/light-prompt`).set(h).send({ content: '決まり' })).status).toBe(200);
    expect((await request(app).put(`/config/room/${room}/claude-md`).set(h).send({ content: '# 指示' })).status).toBe(200);
    expect((await request(app).put(`/config/room/${room}/settings`).set(h).send({ settings: { response_mode: 'mention', enabled: true } })).status).toBe(200);
    expect((await request(app).put(`/config/room/${room}/mcp`).set(h).send({ mcpConfig: { mcpServers: {} } })).status).toBe(200);

    for (const f of ['light_prompt.md', 'CLAUDE.md', 'room_settings.json', 'mcp_config.json'] as const) {
      expect(fs.existsSync(roomConfigPath(ws, f))).toBe(true);
      expect(fs.existsSync(path.join(ws, f))).toBe(false);
    }
    expect(fs.readFileSync(roomConfigPath(ws, 'light_prompt.md'), 'utf8')).toBe('決まり');
    expect(path.relative(ws, roomConfigPath(ws, 'light_prompt.md')).startsWith('..')).toBe(true);
  });

  test('★ GET は _room-configs を返す (workspace の中に AI が置いたものは返さない)', async () => {
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'light_prompt.md'), 'AI が書いた決まり');
    const res = await request(app).get(`/config/room/${room}/light-prompt`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('決まり');
    const s = await request(app).get(`/config/room/${room}/settings`).set('Authorization', `Bearer ${token}`);
    expect(s.body.settings.response_mode).toBe('mention');
  });

  test('★ 旧 (workspace 内) にしか無ければ GET で 1 度だけ移し、旧は消す', async () => {
    const room2 = `${room}-legacy`;
    const ws2 = path.join(ROOT, 'bot-uuid', room2);
    fs.mkdirSync(ws2, { recursive: true });
    fs.writeFileSync(path.join(ws2, 'CLAUDE.md'), '# 旧の指示');
    try {
      const res = await request(app).get(`/config/room/${room2}/claude-md`).set('Authorization', `Bearer ${token}`);
      expect(res.body.content).toBe('# 旧の指示');
      expect(fs.existsSync(path.join(ws2, 'CLAUDE.md'))).toBe(false);
      expect(fs.readFileSync(roomConfigPath(ws2, 'CLAUDE.md'), 'utf8')).toBe('# 旧の指示');
    } finally {
      fs.rmSync(ws2, { recursive: true, force: true });
      fs.rmSync(path.dirname(roomConfigPath(ws2, 'CLAUDE.md')), { recursive: true, force: true });
    }
  });
});
