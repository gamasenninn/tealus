/**
 * ルームMCPマネージャー テスト
 */

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockListTools = jest.fn().mockResolvedValue([{ name: 'read_file' }]);

jest.mock('@openai/agents', () => ({
  MCPServerStdio: jest.fn().mockImplementation((opts: { name: string }) => ({
    name: opts.name,
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
  })),
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  MCP_CACHE_TTL: 100,  // テスト用に短く
  MCP_SWEEP_INTERVAL: 50,
}));

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { roomConfigPath } from '../../src/lib/roomConfigPaths.mts';

// ★ G-1 ルームの mcp_config.json の置き場は workspace の外 <ROOT>/_room-configs/<agentId>/<roomId>/。
//   workspace は契約どおり <ROOT>/<agentId>/<roomId> の 2 階層にする (1 階層だと _room-configs が temp の外に作られる。deep.test.mts と同じ穴)
let tmpRoot: string;
let tmpDir: string;
const writeRoomMcp = (ws: string, obj: unknown) => {
  const p = roomConfigPath(ws, 'mcp_config.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
};

beforeEach(() => {
  jest.clearAllMocks();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  tmpDir = path.join(tmpRoot, 'agent1', 'room1');
  fs.mkdirSync(tmpDir, { recursive: true });
  // roomMcpManager のキャッシュをクリア（モジュールリロード）
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('roomMcpManager', () => {
  test('初回はMCP接続を作成してキャッシュする', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(servers.length).toBeGreaterThan(0);
    expect(mockConnect).toHaveBeenCalled();
  });

  test('2回目はキャッシュから返す（connectを呼ばない）', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connectCount = mockConnect.mock.calls.length;

    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockConnect.mock.calls.length).toBe(connectCount);  // 増えない
  });

  test('★★ 部屋の mcp_config.json を書き換えたら、次の呼び出しで作り直す (改善ループ 30。会話モードだけ最大 30 分古い道具のままだった)', async () => {
    writeRoomMcp(tmpDir, { mcpServers: {} });
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connects = mockConnect.mock.calls.length;
    const p = roomConfigPath(tmpDir, 'mcp_config.json');
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { extra: { command: 'node', args: ['x.js'] } } }));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(p, later, later);

    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockConnect.mock.calls.length).toBeGreaterThan(connects);
    // ★ 古い接続はすぐには閉じない (会話中のセッションがまだ握っている。改善ループ 32)
    expect(mockClose).not.toHaveBeenCalled();
  });

  test('★★ 作り直した古い接続は、掃除の時間 (MCP_CACHE_TTL) が過ぎてから閉じる', async () => {
    writeRoomMcp(tmpDir, { mcpServers: {} });
    const { getOrCreateRoomMcp, startSweeper, stopSweeper } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const p = roomConfigPath(tmpDir, 'mcp_config.json');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(p, later, later);
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockClose).not.toHaveBeenCalled();

    startSweeper();
    await new Promise((r) => setTimeout(r, 250));   // TTL 100ms + 掃除 50ms ごと
    stopSweeper();
    expect(mockClose).toHaveBeenCalledTimes(2);   // 古い接続 (外したもの) と、使われなくなった新しい接続の両方
  });

  test('★ 部屋の mcp_config.json を消したときも作り直す', async () => {
    writeRoomMcp(tmpDir, { mcpServers: {} });
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connects = mockConnect.mock.calls.length;
    fs.rmSync(roomConfigPath(tmpDir, 'mcp_config.json'));

    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockConnect.mock.calls.length).toBeGreaterThan(connects);
  });

  test('異なるルームは別のキャッシュエントリだがグローバルMCPは共有', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers1 = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connectCountAfterRoom1 = mockConnect.mock.calls.length;

    const servers2 = await getOrCreateRoomMcp('agent1', 'room2', tmpDir);
    // room2 では filesystem のみ新規 connect（グローバルMCPは共有なので再connectしない）
    const newConnects = mockConnect.mock.calls.length - connectCountAfterRoom1;
    expect(newConnects).toBe(1); // filesystem のみ

    // 両ルームとも同じグローバルサーバーを含む
    const globalInRoom1 = servers1.filter((s: { name: string }) => s.name.startsWith('global-'));
    const globalInRoom2 = servers2.filter((s: { name: string }) => s.name.startsWith('global-'));
    expect(globalInRoom1).toEqual(globalInRoom2);
  });

  test('closeAllRoomMcp は全サーバー（共有含む）をclose', async () => {
    const { getOrCreateRoomMcp, closeAllRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    await getOrCreateRoomMcp('agent1', 'room2', tmpDir);

    await closeAllRoomMcp();
    // filesystem(room1) + filesystem(room2) + shared global servers
    expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('ルーム固有mcp_config.jsonがあれば追加サーバーを接続', async () => {
    writeRoomMcp(tmpDir, {
      mcpServers: {
        custom_db: { command: 'node', args: ['db-mcp.js'] }
      }
    });

    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    // filesystem + custom_db + global servers
    expect(servers.length).toBeGreaterThanOrEqual(2);
  });

  test('ルーム固有configにfilesystemがあれば自動生成スキップ', async () => {
    writeRoomMcp(tmpDir, {
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/custom/path'] }
      }
    });

    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const names = servers.map((s: { name: string }) => s.name);
    expect(names).not.toContain('tealus-workspace-fs');
    expect(names).toContain('room-room1-filesystem');
  });
});

// ★ #573 ルーム固有の道具の子プロセスにも、許可した環境変数だけを渡す (#565 / #570 と同じ形)。
//   以前は agent-server の環境変数を全部渡していた (本体の署名鍵・DB のパスワードを含む)
describe('★ #573 道具の子プロセスに渡す環境変数', () => {
  test('★ 設定の道具・自動の filesystem とも、許可外の変数を渡さない (設定の env は渡す)', async () => {
    process.env.JWT_SECRET = 'jwt-secret-573';
    process.env.DB_PASSWORD = 'db-secret-573';
    process.env.HKSDB_DSN = 'mysql://u:p@h/db';
    try {
      writeRoomMcp(tmpDir, {
        mcpServers: { custom_db: { command: 'node', args: ['db-mcp.js'], env: { DSN: '${HKSDB_DSN}' } } },
      });
      const { MCPServerStdio } = require('@openai/agents');
      const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
      await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
      const calls = (MCPServerStdio as jest.Mock).mock.calls.map((c) => c[0] as { name: string; env: Record<string, string> });
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.env.JWT_SECRET).toBeUndefined();
        expect(c.env.DB_PASSWORD).toBeUndefined();
        expect(Object.keys(c.env).some((k) => k.toUpperCase() === 'PATH')).toBe(true);
      }
      const db = calls.find((c) => c.name === 'room-room1-custom_db')!;
      expect(db.env.DSN).toBe('mysql://u:p@h/db');
    } finally {
      delete process.env.JWT_SECRET; delete process.env.DB_PASSWORD; delete process.env.HKSDB_DSN;
    }
  });
});

describe('★ #577 自動の filesystem は固定した版', () => {
  test('★ tealus-workspace-fs は 名前@版 で起動する', async () => {
    const { MCPServerStdio } = require('@openai/agents');
    const { FILESYSTEM_MCP_PACKAGE } = require('../../src/lib/mcpPackages.mts');
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const fsCall = (MCPServerStdio as jest.Mock).mock.calls.map((c) => c[0]).find((o: { name: string }) => o.name === 'tealus-workspace-fs');
    expect(fsCall.args).toContain(FILESYSTEM_MCP_PACKAGE);
  });
});

// ★ 2026-10-23 (改善ループ 12 回目): 改善ループ 9 回目の F は Light v2・Deep に入ったが、会話モードと Light v1 が使う
//   この経路には無かった。部屋の設定の tealus がつながると、道具の取り込みは先勝ちなので send_message 等が部屋側に向いた
describe('部屋の mcp_config.json の tealus はつながない', () => {
  test('tealus は捨て、ほかの道具はつなぐ', async () => {
    const { MCPServerStdio } = require('@openai/agents') as { MCPServerStdio: jest.Mock };
    writeRoomMcp(tmpDir, { mcpServers: {
      tealus: { command: 'node', args: ['other.js'] },
      extra: { command: 'npx', args: ['x'] },
    } });
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'roomT', tmpDir);
    const names = MCPServerStdio.mock.calls.map((c: [{ name: string }]) => c[0].name);
    expect(names).toContain('room-roomT-extra');
    expect(names).not.toContain('room-roomT-tealus');
    const { logger } = require('../../src/lib/logger.mts') as { logger: { warn: jest.Mock } };
    expect(logger.warn.mock.calls.some((c) => String(c[0]).includes('tealus'))).toBe(true);
  });
});
