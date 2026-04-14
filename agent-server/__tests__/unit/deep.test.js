/**
 * Deep Agent テスト
 */

jest.mock('../../src/lib/botApi', () => ({
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../src/context/sessionManager', () => ({
  updateContext: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  DEEP_TIMEOUT: 100,  // テスト用に短く
  DEEP_MAX_BUFFER: 1024 * 1024,
}));

// child_process をモック
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  execFile: jest.fn(),
  spawn: mockSpawn,
}));

const { processDeep, buildClaudeArgs } = require('../../src/agents/deep');
const botApi = require('../../src/lib/botApi');
const sessionManager = require('../../src/context/sessionManager');

describe('Deep Agent', () => {

  describe('buildClaudeArgs', () => {
    test('基本引数を構築する', () => {
      const args = buildClaudeArgs({
        prompt: 'レポートを作成して',
      });

      expect(args).toContain('-p');
      expect(args).toContain('レポートを作成して');
      expect(args).toContain('--dangerously-skip-permissions');
    });

    test('session_id がある場合は --resume を追加', () => {
      const args = buildClaudeArgs({
        prompt: '続きをお願い',
        sessionId: 'sess-123',
      });

      expect(args).toContain('--resume');
      expect(args).toContain('sess-123');
    });

    test('session_id がない場合は --resume なし', () => {
      const args = buildClaudeArgs({
        prompt: '新しいタスク',
      });

      expect(args).not.toContain('--resume');
    });
  });

  describe('processDeep', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('claude -p を実行して応答を送信する', async () => {
      // spawn のモック: 正常終了
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
      };

      // stdout にデータが来て、close で終了
      mockProcess.stdout.on.mockImplementation((event, cb) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from('レポートが完成しました。')), 10);
        }
      });
      mockProcess.stderr.on.mockImplementation(() => {});
      mockProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 20);
        }
      });

      mockSpawn.mockReturnValueOnce(mockProcess);

      await processDeep({
        roomId: 'room1',
        prompt: 'レポートを作成して',
        workspacePath: '/tmp/workspace',
        agentId: 'agent1',
        sessionId: null,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('claude'),
        expect.arrayContaining(['-p', '--dangerously-skip-permissions']),
        expect.objectContaining({ cwd: '/tmp/workspace' })
      );

      expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('レポート'));
    });

    test('タイムアウト時はエラーメッセージを送信', async () => {
      let closeCallback;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn().mockImplementation(() => {
          // kill されたら close を発火
          if (closeCallback) setTimeout(() => closeCallback(null), 5);
        }),
        killed: false,
      };

      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});
      mockProcess.on.mockImplementation((event, cb) => {
        if (event === 'close') closeCallback = cb;
      });

      mockSpawn.mockReturnValueOnce(mockProcess);

      await processDeep({
        roomId: 'room1',
        prompt: 'テスト',
        workspacePath: '/tmp/workspace',
        agentId: 'agent1',
        sessionId: null,
      });

      expect(mockProcess.kill).toHaveBeenCalled();
      expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('タイムアウト'));
    });
  });
});
