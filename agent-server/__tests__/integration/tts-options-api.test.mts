/**
 * 統合テスト: GET /config/tts-options (2026-09-26、ルームごとの読み上げエンジン・声)
 *
 * ★ ダッシュボードのルーム設定が、エンジンと声の一覧をここから受け取る。
 *   それまで Aivis の 10 種はダッシュボードのコードに直接書いてあった (一覧を 1 か所にする)。
 * ★★ 鍵の値は返さない。「使えるか (available)」だけ。
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express, { type Express } from 'express';

const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-options-test-'));
process.env.AGENT_CONFIG_DIR = tmpConfigDir;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpConfigDir, 'mcp_config.json');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const originalAivis = process.env.AIVIS_API_KEY;
process.env.AIVIS_API_KEY = 'aivis-secret-value';

afterAll(() => {
  delete process.env.AGENT_CONFIG_DIR;
  delete process.env.AGENT_MCP_CONFIG_PATH;
  if (originalAivis === undefined) delete process.env.AIVIS_API_KEY; else process.env.AIVIS_API_KEY = originalAivis;
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/context/settingsManager.mts', () => ({
  getAllSettings: jest.fn(() => ({})), saveSettings: jest.fn(), loadSettings: jest.fn(), getSetting: jest.fn((_k: string, d: unknown) => d),
}));
jest.mock('../../src/lib/botApi.mts', () => ({ getBotUserId: jest.fn(() => 'bot-uuid') }));
jest.mock('../../src/mcp/roomMcpManager.mts', () => ({ invalidateRoomMcp: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/config.mts', () => ({
  WORKSPACE_ROOT: require('node:os').tmpdir(),
  TTS_PROVIDER: 'openai',
  OPENAI_API_KEY: 'openai-secret-value',
  GOOGLE_API_KEY: '',
}));

const { authenticate } = require('../../src/middleware/auth');
const { router: settingsRoutes } = require('../../src/routes/settings');
const token = jwt.sign({ id: 'admin1', login_id: 'ADMIN' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
let app: Express;
beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/config', authenticate, settingsRoutes);
});

describe('GET /config/tts-options', () => {
  test('★ 全体の設定・エンジン・声の一覧を返す', async () => {
    const res = await request(app).get('/config/tts-options').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.global_provider).toBe('openai');
    expect(res.body.default_engine).toBe('openai');
    expect(res.body.room_override_effective).toBe(true);
    expect(res.body.engines.map((e: { id: string }) => e.id)).toEqual(['aivis', 'openai', 'gemini']);
    expect(res.body.voices.gemini.map((v: { id: string }) => v.id)).toContain('Kore');
    expect(res.body.voices.aivis).toHaveLength(10);
  });

  test('★ 鍵があるかだけを返す (gemini は鍵が空 → 使えない)', async () => {
    const res = await request(app).get('/config/tts-options').set('Authorization', `Bearer ${token}`);
    const avail = Object.fromEntries(res.body.engines.map((e: { id: string; available: boolean }) => [e.id, e.available]));
    expect(avail).toEqual({ aivis: true, openai: true, gemini: false });
  });

  test('★★ 鍵の値は応答に 1 文字も含まれない', async () => {
    const res = await request(app).get('/config/tts-options').set('Authorization', `Bearer ${token}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('openai-secret-value');
    expect(body).not.toContain('aivis-secret-value');
  });

  test('認証なしは 401', async () => {
    const res = await request(app).get('/config/tts-options');
    expect(res.status).toBe(401);
  });
});
