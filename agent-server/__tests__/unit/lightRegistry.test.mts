/**
 * lightRegistry テスト — 通常応答 (Light) の中断
 *
 * Deep (#250) と違い Light は子プロセスのハンドルを持てない (codex SDK が spawn を隠蔽する)。
 * そのため「協調フラグ」+「workspace path 一致での sweep kill」の 2 段で止める。
 *
 * ★ 最重要の不変条件: cancel しても Map から消さない。
 *   走行中の processLight が次に isCancelled() を見るまで flag が生きている必要がある
 *   (deepRegistry は kill するので消してよいが、こちらは協調なので消すと break できない)。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// ESM の import 巻き上げ対策 (deepRegistry.test.mts と同型)。
// sweepByWorkspacePath は本物を通し、その先の spawn だけ mock して検証する。
jest.mock('node:child_process', () => {
  const mockSpawnFn = jest.fn();
  return { spawn: mockSpawnFn, __mockSpawn: mockSpawnFn };
});

import * as childProcess from 'node:child_process';
const mockSpawn = (childProcess as unknown as { __mockSpawn: jest.Mock }).__mockSpawn;
import * as lightRegistry from '../../src/agents/lightRegistry.mts';

const WORKSPACE = 'C:/app/tealus-workspaces/agent1/room1';

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  lightRegistry.unregister('room1');
  lightRegistry.unregister('room2');
});

describe('lightRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue({ unref: jest.fn() });
  });

  describe('register / unregister / isRunning', () => {
    test('register + isRunning + unregister の基本 cycle', () => {
      expect(lightRegistry.isRunning('room1')).toBe(false);
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      expect(lightRegistry.isRunning('room1')).toBe(true);
      lightRegistry.unregister('room1');
      expect(lightRegistry.isRunning('room1')).toBe(false);
    });

    test('unregister は冪等 (2 回目以降 no-op)', () => {
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      lightRegistry.unregister('room1');
      lightRegistry.unregister('room1');
      expect(lightRegistry.isRunning('room1')).toBe(false);
    });

    test('workspacePath 無しでも register できる', () => {
      lightRegistry.register('room1');
      expect(lightRegistry.isRunning('room1')).toBe(true);
      expect(lightRegistry.isCancelled('room1')).toBe(false);
    });
  });

  describe('isCancelled', () => {
    test('register 直後は false', () => {
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      expect(lightRegistry.isCancelled('room1')).toBe(false);
    });

    test('未 register の room は false (走っていないものは中断されていない)', () => {
      expect(lightRegistry.isCancelled('never-registered')).toBe(false);
    });

    test('★ unregister すると flag は消える (次の run が古い中断を引き継がない)', () => {
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      lightRegistry.cancel('room1');
      expect(lightRegistry.isCancelled('room1')).toBe(true);

      lightRegistry.unregister('room1');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      expect(lightRegistry.isCancelled('room1')).toBe(false);
    });
  });

  describe('cancel', () => {
    test('未 register の room: was_running=false', () => {
      expect(lightRegistry.cancel('not-registered-room')).toEqual({ success: true, was_running: false });
    });

    test('register された room を cancel: was_running=true + isCancelled=true', () => {
      setPlatform('win32');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });

      const result = lightRegistry.cancel('room1');

      expect(result.success).toBe(true);
      expect(result.was_running).toBe(true);
      expect(lightRegistry.isCancelled('room1')).toBe(true);
    });

    test('★ cancel しても Map から消さない (走行中の loop が flag を読めなくなるため)', () => {
      setPlatform('win32');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });

      lightRegistry.cancel('room1');

      expect(lightRegistry.isRunning('room1')).toBe(true);
      expect(lightRegistry.isCancelled('room1')).toBe(true);
    });

    test('2 回 cancel しても was_running=true のまま (押し直しで壊れない)', () => {
      setPlatform('win32');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });

      lightRegistry.cancel('room1');
      const second = lightRegistry.cancel('room1');

      expect(second.was_running).toBe(true);
      expect(lightRegistry.isCancelled('room1')).toBe(true);
    });

    test('cancel が workspace path で PowerShell sweep を起動 (Windows)', () => {
      setPlatform('win32');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });

      lightRegistry.cancel('room1');

      const powerShellCall = mockSpawn.mock.calls.find(
        (call: unknown[]) => call[0] === 'powershell' && JSON.stringify(call[1]).includes('Get-CimInstance')
      );
      expect(powerShellCall).toBeDefined();
      const args = powerShellCall![1] as string[];
      const script = args[args.indexOf('-Command') + 1];
      // Light v2 の実体は codex.exe / その launcher の node.exe
      expect(script).toContain("Name='codex.exe'");
      expect(script).toContain("Name='node.exe'");
      expect(script).toContain(WORKSPACE);
    });

    test('workspacePath 未設定なら sweep は起動しない (flag だけ立つ)', () => {
      setPlatform('win32');
      lightRegistry.register('room1');

      const result = lightRegistry.cancel('room1');

      expect(result.was_running).toBe(true);
      expect(lightRegistry.isCancelled('room1')).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    test('別 room の run は巻き込まない', () => {
      setPlatform('win32');
      lightRegistry.register('room1', { workspacePath: WORKSPACE });
      lightRegistry.register('room2', { workspacePath: 'C:/app/tealus-workspaces/agent1/room2' });

      lightRegistry.cancel('room1');

      expect(lightRegistry.isCancelled('room1')).toBe(true);
      expect(lightRegistry.isCancelled('room2')).toBe(false);
    });
  });
});
