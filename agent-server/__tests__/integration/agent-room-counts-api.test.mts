/**
 * 統合テスト: GET /config/agent-room-counts (2026-09-26)
 *
 * ★ なぜ: ダッシュボードのエージェント一覧で、ルーム設定の入口が文字の無い吹き出しアイコンだった。
 *   しかもルームに属しているのはアシスタントだけで、他のエージェントは押しても空の一覧になる。
 *   → 利用者判断「登録があるものとないものが一目瞭然になるように」→ エージェントごとのルーム数を出す。
 * ★★ 数え方はルーム一覧 (GET /config/rooms/:agentId) と同じ (= 退出済みのルームは数えない)。
 *   一覧と数が食い違うと、また「押したら違った」になる。
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express, { type Express } from 'express';

const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-room-counts-'));
const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-room-counts-cfg-'));
process.env.AGENT_CONFIG_DIR = tmpConfigDir;
process.env.AGENT_MCP_CONFIG_PATH = path.join(tmpConfigDir, 'mcp_config.json');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// ★ アシスタント: 3 ルームのフォルダ (うち room-gone は退出済み = 本体の一覧に無い)
for (const r of ['room-a', 'room-b', 'room-gone']) fs.mkdirSync(path.join(tmpWs, 'agent-assistant', r), { recursive: true });
fs.writeFileSync(path.join(tmpWs, 'agent-assistant', 'not-a-dir.txt'), 'x');
// ★ 作業用のフォルダ (_ で始まる) はエージェントではない
fs.mkdirSync(path.join(tmpWs, '_voice-chat-logs'), { recursive: true });

afterAll(() => {
  delete process.env.AGENT_CONFIG_DIR;
  delete process.env.AGENT_MCP_CONFIG_PATH;
  fs.rmSync(tmpWs, { recursive: true, force: true });
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
jest.mock('../../src/context/settingsManager.mts', () => ({
  getAllSettings: jest.fn(() => ({})), saveSettings: jest.fn(), loadSettings: jest.fn(), getSetting: jest.fn((_k: string, d: unknown) => d),
}));
jest.mock('../../src/lib/botApi.mts', () => ({
  getBotUserId: jest.fn(() => 'agent-assistant'),
  getRooms: jest.fn(async () => [
    { id: 'room-a', name: 'A', type: 'group', member_count: 3 },
    { id: 'room-b', name: 'B', type: 'group', member_count: 2 },
  ]),
}));
jest.mock('../../src/mcp/roomMcpManager.mts', () => ({ invalidateRoomMcp: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../src/config.mts', () => ({ WORKSPACE_ROOT: tmpWs, TTS_PROVIDER: 'openai' }));

const { authenticate } = require('../../src/middleware/auth');
const { router: settingsRoutes } = require('../../src/routes/settings');
const token = jwt.sign({ id: 'admin1', login_id: 'ADMIN' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
let app: Express;
beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/config', authenticate, settingsRoutes);
});

describe('GET /config/agent-room-counts', () => {
  test('★ エージェントごとのルーム数 (退出済み・ファイル・_ で始まる作業フォルダは数えない)', async () => {
    const res = await request(app).get('/config/agent-room-counts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ 'agent-assistant': 2 });
  });

  test('★★ ルーム一覧 (GET /config/rooms/:agentId) と同じ数になる', async () => {
    const counts = await request(app).get('/config/agent-room-counts').set('Authorization', `Bearer ${token}`);
    const list = await request(app).get('/config/rooms/agent-assistant').set('Authorization', `Bearer ${token}`);
    expect(counts.body.counts['agent-assistant']).toBe(list.body.rooms.length);
  });
});
