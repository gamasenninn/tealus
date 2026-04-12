/**
 * セッションマネージャーのテスト
 */

// pg をモック（hoisting対応）
const mockQuery = jest.fn();
jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mockQuery,
    })),
  };
});

// logger をモック
jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// config をモック
jest.mock('../../src/config', () => ({
  WORKSPACE_ROOT: '/tmp/test-workspaces',
}));

// fs をモック
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(() => false),
  writeFileSync: jest.fn(),
}));

const { getOrCreateContext, updateContext, updateStatus } = require('../../src/context/sessionManager');

describe('SessionManager', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('getOrCreateContext', () => {
    test('既存コンテキストを返す', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ctx1', agent_id: 'agent1', room_id: 'room1', workspace_path: 'path', status: 'idle' }],
      });

      const ctx = await getOrCreateContext('agent1', 'room1');
      expect(ctx.id).toBe('ctx1');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    test('存在しない場合は新規作成する', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ctx2', agent_id: 'agent1', room_id: 'room2', workspace_path: '/tmp/test-workspaces/agent1/room2', status: 'idle' }],
      });

      const ctx = await getOrCreateContext('agent1', 'room2');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1][0]).toContain('INSERT');
    });
  });

  describe('updateStatus', () => {
    test('ステータスを更新する', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ status: 'processing' }] });

      await updateStatus('agent1', 'room1', 'processing');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE'),
        expect.arrayContaining(['processing', 'agent1', 'room1'])
      );
    });
  });

  describe('updateContext', () => {
    test('session_idを更新する', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await updateContext('agent1', 'room1', { session_id: 'sess123' });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('session_id'),
        expect.arrayContaining(['sess123'])
      );
    });

    test('更新項目がない場合はクエリを実行しない', async () => {
      await updateContext('agent1', 'room1', {});
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
