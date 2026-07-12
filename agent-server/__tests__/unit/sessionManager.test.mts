/**
 * セッションマネージャーのテスト
 */

// pg をモック（hoisting対応）
// ESM import 巻き上げにより SUT (sessionManager.mts) がモジュール読込時に `new pg.Pool()` を
// 実行するため、外側 const を factory から参照すると TDZ になる (router.test.mts と同型)。
// factory 内で mock query fn を生成し __mockQuery として公開、import 後に取り出す。
jest.mock('pg', () => {
  const mockQueryFn = jest.fn();
  const MockPool = jest.fn().mockImplementation(() => ({
    query: mockQueryFn,
  }));
  (MockPool as unknown as { __mockQuery: jest.Mock }).__mockQuery = mockQueryFn;
  return { Pool: MockPool };
});

// logger をモック
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// config をモック
jest.mock('../../src/config.mts', () => ({
  WORKSPACE_ROOT: '/tmp/test-workspaces',
}));

// fs をモック
jest.mock('node:fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn(() => false),
  writeFileSync: jest.fn(),
}));

import pg from 'pg';
const mockQuery = (pg.Pool as unknown as { __mockQuery: jest.Mock }).__mockQuery;
import { getOrCreateContext, updateContext, updateStatus } from '../../src/context/sessionManager.mts';

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

    test('agentId が null だと clear な error を throw (#225)', async () => {
      await expect(getOrCreateContext(null as unknown as string, 'room1')).rejects.toThrow(/agentId is required/);
      await expect(getOrCreateContext(undefined as unknown as string, 'room1')).rejects.toThrow(/agentId is required/);
      // DB query は呼ばれない (validation で先に throw)
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('roomId が null だと clear な error を throw (#225)', async () => {
      await expect(getOrCreateContext('agent1', null as unknown as string)).rejects.toThrow(/roomId is required/);
      await expect(getOrCreateContext('agent1', undefined as unknown as string)).rejects.toThrow(/roomId is required/);
      expect(mockQuery).not.toHaveBeenCalled();
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
