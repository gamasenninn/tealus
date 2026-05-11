/**
 * deepRegistry テスト (Step 27 follow-up、本 fix で sweepByWorkspacePath を export 化)
 */
const { EventEmitter } = require('events');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: mockSpawn }));

const deepRegistry = require('../../src/agents/deepRegistry');

function makeMockProcess(overrides = {}) {
  const proc = Object.assign(new EventEmitter(), {
    pid: 12345,
    killed: false,
    exitCode: null,
    signalCode: null,
    kill: jest.fn(),
    _tealusWorkspacePath: 'C:/app/tealus-workspaces/agent1/room1',
  }, overrides);
  return proc;
}

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  // Map に残った state を clean
  deepRegistry.unregister('room1');
  deepRegistry.unregister('room-special');
});

describe('deepRegistry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue({ unref: jest.fn() });
  });

  describe('register / unregister / isRunning', () => {
    test('register + isRunning + unregister の基本 cycle', () => {
      expect(deepRegistry.isRunning('room1')).toBe(false);
      const proc = makeMockProcess();
      deepRegistry.register('room1', proc);
      expect(deepRegistry.isRunning('room1')).toBe(true);
      deepRegistry.unregister('room1');
      expect(deepRegistry.isRunning('room1')).toBe(false);
    });

    test('unregister は冪等 (2 回目以降 no-op)', () => {
      const proc = makeMockProcess();
      deepRegistry.register('room1', proc);
      deepRegistry.unregister('room1');
      deepRegistry.unregister('room1'); // 2 回目
      expect(deepRegistry.isRunning('room1')).toBe(false);
    });
  });

  describe('cancel', () => {
    test('未 register の room: was_running=false', () => {
      const result = deepRegistry.cancel('not-registered-room');
      expect(result).toEqual({ success: true, was_running: false });
    });

    test('register された proc を cancel: was_running=true、kill 呼ばれ unregister される', () => {
      setPlatform('win32');
      const proc = makeMockProcess();
      deepRegistry.register('room1', proc);

      const result = deepRegistry.cancel('room1');

      expect(result.success).toBe(true);
      expect(result.was_running).toBe(true);
      expect(result.pid).toBe(12345);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc._tealusCancelled).toBe(true);
      expect(deepRegistry.isRunning('room1')).toBe(false);
    });

    test('cancel が sweepByWorkspacePath 経由で PowerShell sweep を起動 (Windows)', () => {
      setPlatform('win32');
      const proc = makeMockProcess();
      deepRegistry.register('room1', proc);

      deepRegistry.cancel('room1');

      // spawn が呼ばれた中で powershell + Get-CimInstance を含む call を検出
      const powerShellCall = mockSpawn.mock.calls.find(
        (call) => call[0] === 'powershell' && JSON.stringify(call[1]).includes('Get-CimInstance')
      );
      expect(powerShellCall).toBeDefined();
      expect(powerShellCall[1]).toContain('-NoProfile');
    });

    test('clearTimeout を proc._tealusTimer に対して呼ぶ', () => {
      const proc = makeMockProcess();
      const timer = setTimeout(() => {}, 999999);
      proc._tealusTimer = timer;
      deepRegistry.register('room1', proc);

      deepRegistry.cancel('room1');

      expect(proc._tealusTimer).toBeNull();
    });
  });

  describe('sweepByWorkspacePath', () => {
    test('non-win32 では no-op (spawn 呼ばれない)', () => {
      setPlatform('linux');
      deepRegistry.sweepByWorkspacePath('/path/to/workspace', 'room1');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    test('workspacePath が空 / undefined なら no-op', () => {
      setPlatform('win32');
      deepRegistry.sweepByWorkspacePath('', 'room1');
      deepRegistry.sweepByWorkspacePath(undefined, 'room1');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    test('win32 + workspacePath あり: powershell -Command で Get-CimInstance + Stop-Process 起動', () => {
      setPlatform('win32');
      deepRegistry.sweepByWorkspacePath('C:/app/tealus-workspaces/agent1/room1', 'room1');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [command, args] = mockSpawn.mock.calls[0];
      expect(command).toBe('powershell');
      expect(args).toContain('-NoProfile');
      expect(args).toContain('-NonInteractive');
      expect(args).toContain('-Command');
      const script = args[args.indexOf('-Command') + 1];
      expect(script).toContain('Get-CimInstance Win32_Process');
      expect(script).toContain('Stop-Process');
      // workspace path が WQL LIKE で含まれる
      expect(script).toContain('C:/app/tealus-workspaces/agent1/room1');
      // Name filter で claude.exe / cmd.exe に限定 (self-kill 防止)
      expect(script).toContain("Name='claude.exe'");
      expect(script).toContain("Name='cmd.exe'");
    });

    test('WQL escape: ' + "\\ ' [ _ % を含む path を正しく escape", () => {
      setPlatform('win32');
      // \ → \\、' → ''、[ → [[]、_ → [_]、% → [%]
      const tricky = "C:\\path\\with'quote\\and[bracket\\under_score\\percent%";
      deepRegistry.sweepByWorkspacePath(tricky, 'room-special');

      const script = mockSpawn.mock.calls[0][1][mockSpawn.mock.calls[0][1].indexOf('-Command') + 1];
      // \ が \\ に escape されている (WQL LIKE のため)
      expect(script).toMatch(/C:\\\\path\\\\with/);
      // ' が '' に escape されている (SQL string)
      expect(script).toContain("with''quote");
      // [ → [[]、_ → [_]、% → [%]
      expect(script).toContain('and[[]bracket');
      expect(script).toContain('under[_]score');
      expect(script).toContain('percent[%]');
    });
  });
});
