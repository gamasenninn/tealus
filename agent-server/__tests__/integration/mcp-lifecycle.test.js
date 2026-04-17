/**
 * 統合テスト: MCP 接続ライフサイクル
 * キャッシュ、共有、無効化の動作を検証。
 */

const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);

jest.mock('@openai/agents', () => ({
  MCPServerStdio: jest.fn().mockImplementation((opts) => ({
    name: opts.name,
    connect: mockConnect,
    close: mockClose,
  })),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  MCP_CACHE_TTL: 100,
  MCP_SWEEP_INTERVAL: 50,
  WORKSPACE_ROOT: './test-workspaces',
}));

jest.mock('../../src/lib/botApi', () => ({
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-int-test-'));
  jest.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP ライフサイクル統合テスト', () => {

  // --- 1. 初回接続 → キャッシュ ---
  test('1. 初回接続 → connect 呼ばれキャッシュされる', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(servers.length).toBeGreaterThan(0);
    expect(mockConnect).toHaveBeenCalled();
  });

  // --- 2. 2回目 → キャッシュヒット ---
  test('2. 2回目アクセス → connect が呼ばれない', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connectCount = mockConnect.mock.calls.length;

    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockConnect.mock.calls.length).toBe(connectCount);
  });

  // --- 3. グローバル MCP 共有 ---
  test('3. 異なるルーム → グローバル MCP は共有（再 connect なし）', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers1 = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    const connectAfterRoom1 = mockConnect.mock.calls.length;

    const servers2 = await getOrCreateRoomMcp('agent1', 'room2', tmpDir);
    const newConnects = mockConnect.mock.calls.length - connectAfterRoom1;

    // filesystem のみ新規 connect（グローバルは共有）
    expect(newConnects).toBe(1);

    // グローバルサーバーが共有されている
    const global1 = servers1.filter(s => s.name.startsWith('global-'));
    const global2 = servers2.filter(s => s.name.startsWith('global-'));
    expect(global1).toEqual(global2);
  });

  // --- 4. invalidateRoomMcp ---
  test('4. invalidateRoomMcp → 指定ルームだけ close + キャッシュ削除', async () => {
    const { getOrCreateRoomMcp, invalidateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    await getOrCreateRoomMcp('agent1', 'room2', tmpDir);

    await invalidateRoomMcp('agent1', 'room1');

    // room1 の close が呼ばれた
    expect(mockClose).toHaveBeenCalled();

    // room1 は再度 connect が必要（キャッシュ削除済み）
    mockConnect.mockClear();
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    expect(mockConnect).toHaveBeenCalled();
  });

  // --- 5. closeAllRoomMcp ---
  test('5. closeAllRoomMcp → 全サーバー close', async () => {
    const { getOrCreateRoomMcp, closeAllRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent1', 'room1', tmpDir);
    await getOrCreateRoomMcp('agent1', 'room2', tmpDir);

    await closeAllRoomMcp();

    // ルーム固有 + 共有グローバル全て close
    expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // --- 6. ルーム固有 mcp_config.json ---
  test('6. ルーム固有 mcp_config.json があれば追加サーバーを接続', async () => {
    fs.writeFileSync(path.join(tmpDir, 'mcp_config.json'), JSON.stringify({
      mcpServers: {
        custom_db: { command: 'node', args: ['db-mcp.js'] }
      }
    }));

    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    const servers = await getOrCreateRoomMcp('agent1', 'room1', tmpDir);

    // filesystem + custom_db + グローバル
    expect(servers.length).toBeGreaterThanOrEqual(2);
  });
});
