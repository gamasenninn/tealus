/**
 * 統合テスト: Deep Agent
 * spawn をモック、stdout/stderr/close イベントをシミュレート。
 */

// spawn モック
let mockProc;
jest.mock('child_process', () => {
  const { EventEmitter } = require('events');
  return {
    spawn: jest.fn(() => {
      mockProc = new EventEmitter();
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.kill = jest.fn();
      return mockProc;
    }),
  };
});

jest.mock('../../src/lib/botApi', () => ({
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../src/context/sessionManager', () => ({
  updateContext: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  DEEP_TIMEOUT: 5000,
  DEEP_MAX_BUFFER: 10485760,
}));

const { processDeep, buildClaudeArgs } = require('../../src/agents/deep');
const botApi = require('../../src/lib/botApi');
const { spawn } = require('child_process');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Deep Agent 統合テスト', () => {

  // --- 1. 正常応答 ---
  test('1. 正常応答 → pushMessage に応答テキスト', async () => {
    const promise = processDeep({ roomId: 'room1', prompt: 'テスト', workspacePath: '/tmp' });

    // stdout にデータ送信
    mockProc.stdout.emit('data', Buffer.from('応答テキストです'));
    // プロセス正常終了
    mockProc.emit('close', 0);

    jest.runAllTimers();
    await promise;

    expect(botApi.pushMessage).toHaveBeenCalledWith('room1', '応答テキストです');
  });

  // --- 2. 長い応答 → 分割送信 ---
  test('2. 長い応答 → splitMessage → 複数 pushMessage', async () => {
    const promise = processDeep({ roomId: 'room1', prompt: 'テスト', workspacePath: '/tmp' });

    // 4000文字超の応答
    mockProc.stdout.emit('data', Buffer.from('x'.repeat(5000)));
    mockProc.emit('close', 0);

    jest.runAllTimers();
    await promise;

    expect(botApi.pushMessage).toHaveBeenCalledTimes(2);
  });

  // --- 3. タイムアウト ---
  test('3. タイムアウト → SIGTERM + タイムアウトメッセージ', async () => {
    const promise = processDeep({ roomId: 'room1', prompt: 'テスト', workspacePath: '/tmp' });

    // タイムアウト発動
    jest.advanceTimersByTime(5000);

    // タイムアウト後にプロセスが閉じる
    mockProc.emit('close', null);

    await promise;

    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('タイムアウト'));
  });

  // --- 4. spawn エラー ---
  test('4. spawn エラー → エラーメッセージ', async () => {
    const promise = processDeep({ roomId: 'room1', prompt: 'テスト', workspacePath: '/tmp' });

    mockProc.emit('error', new Error('command not found'));

    jest.runAllTimers();
    await promise;

    expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('起動に失敗'));
  });

  // --- 5. --resume 引数 ---
  test('5. sessionId あり → --resume 引数に含まれる', () => {
    const args = buildClaudeArgs({ prompt: 'テスト', workspacePath: '/tmp', sessionId: 'session-123' });
    expect(args).toContain('--resume');
    expect(args).toContain('session-123');
  });

  // --- 6. --mcp-config ---
  test('6. mcp_config.json あり → --mcp-config 引数に含まれる', () => {
    const fs = require('fs');
    const tmpPath = require('os').tmpdir() + '/deep-test-' + Date.now();
    fs.mkdirSync(tmpPath, { recursive: true });
    fs.writeFileSync(tmpPath + '/mcp_config.json', '{}');

    const args = buildClaudeArgs({ prompt: 'テスト', workspacePath: tmpPath });
    expect(args).toContain('--mcp-config');

    fs.rmSync(tmpPath, { recursive: true, force: true });
  });
});
