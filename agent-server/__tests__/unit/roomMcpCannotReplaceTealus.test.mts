/**
 * 改善ループ 9 回目の F — 部屋の mcp_config.json に `tealus` を書くと、#606 の待ちの指定 (required) が黙って消えていた。
 *
 * ★ 手順 3 (部屋の MCP) が Object.assign で上書きしていた。手順 4 (共通の MCP) は「既にあれば足さない」で守っていたのに、手順 3 は守っていなかった
 * ★ tealus の道具は本体班が組み立てる (中継の向け先・機械の資格・待ちの指定)。部屋の設定では置き換えさせない
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TEALUS_BOT_ID = process.env.TEALUS_BOT_ID || 'test-bot';
process.env.TEALUS_BOT_PASS = process.env.TEALUS_BOT_PASS || 'test-pass';
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
// ★ env を決めてから読む (config は読み込み時に env を確定する)
const { buildLightV2McpConfig } = require('../../src/agents/lightV2.mts') as {
  buildLightV2McpConfig: (ws: string | undefined) => Record<string, unknown>;
};
const { logger } = require('../../src/lib/logger.mts') as { logger: { warn: jest.Mock } };
const { roomConfigPath } = require('../../src/lib/roomConfigPaths.mts') as typeof import('../../src/lib/roomConfigPaths.mts');

// ★ G-1 ルームの mcp_config.json は workspace の外 (_room-configs)。workspace は <ROOT>/<agentId>/<roomId> の 2 階層
let root: string;
let ws: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'room-mcp-'));
  ws = path.join(root, 'agent-1', 'room-1');
  fs.mkdirSync(ws, { recursive: true });
  (logger.warn as jest.Mock).mockClear();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function writeRoomMcp(servers: Record<string, unknown>): void {
  const p = roomConfigPath(ws, 'mcp_config.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ mcpServers: servers }));
}

test('部屋の設定に tealus があっても、本体班の tealus (required・待ち 60 秒) のまま', () => {
  writeRoomMcp({ tealus: { command: 'node', args: ['other.js'], env: {} } });
  const cfg = buildLightV2McpConfig(ws) as Record<string, { command: string; required?: boolean; startup_timeout_sec?: number }>;
  expect(cfg.tealus.command).toBe('npx');
  expect(cfg.tealus.required).toBe(true);
  expect(cfg.tealus.startup_timeout_sec).toBe(60);
});

test('置き換えを断ったことは記録に残す (黙って捨てない)', () => {
  writeRoomMcp({ tealus: { command: 'node', args: [], env: {} } });
  buildLightV2McpConfig(ws);
  const lines = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0]));
  expect(lines.some((l) => l.includes('tealus') && l.includes('mcp_config.json'))).toBe(true);
});

test('部屋の設定のほかの道具は、今までどおり足される', () => {
  writeRoomMcp({ 'dbhub-mysql': { command: 'npx', args: ['-y', 'dbhub'], env: {} } });
  const cfg = buildLightV2McpConfig(ws);
  expect(cfg['dbhub-mysql']).toBeDefined();
  expect(cfg.tealus).toBeDefined();
});
