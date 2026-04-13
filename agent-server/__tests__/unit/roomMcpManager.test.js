/**
 * ルームMCPマネージャー テスト
 */

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockListTools = jest.fn().mockResolvedValue([{ name: 'read_file' }]);

jest.mock('@openai/agents', () => ({
  MCPServerStdio: jest.fn().mockImplementation((opts) => ({
    name: opts.name,
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
  })),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  MCP_CACHE_TTL: 100,  // テスト用に短く
  MCP_SWEEP_INTERVAL: 50,
}));

const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  // roomMcpManager のキャッシュをクリア（モジュールリロード）
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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

  test('異なるルームは別のキャッシュエントリ', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    await getOrCreateRoomMcp('agent1', 'room2', tmpDir);
    expect(mockConnect.mock.calls.length).toBe(2);
  });

  test('closeAllRoomMcp は全サーバーをclose', async () => {
    const { getOrCreateRoomMcp, closeAllRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    await getOrCreateRoomMcp('agent1', 'room2', tmpDir);

    await closeAllRoomMcp();
    expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('ルーム固有mcp_config.jsonがあれば追加サーバーを接続', async () => {
    fs.writeFileSync(path.join(tmpDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: {
        custom_db: { command: 'node', args: ['db-mcp.js'] }
      }
    }));

    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    // filesystem + custom_db = 2以上
    expect(servers.length).toBeGreaterThanOrEqual(2);
  });

  test('ルーム固有configにfilesystemがあれば自動生成スキップ', async () => {
    fs.writeFileSync(path.join(tmpDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/custom/path'] }
      }
    }));

    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const names = servers.map(s => s.name);
    expect(names).not.toContain('tealus-workspace-fs');
    expect(names).toContain('room-room1-filesystem');
  });
});
