/**
 * Deep Agent テスト
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

jest.mock('../../src/lib/botApi.mts', () => ({
  pushMessage: jest.fn().mockResolvedValue({ message: {} }),
  pushStatus: jest.fn().mockResolvedValue({ success: true }),
  getBotUserId: jest.fn(() => 'bot-uuid'),
}));

jest.mock('../../src/context/sessionManager.mts', () => ({
  updateContext: jest.fn(),
  updateStatus: jest.fn(),
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  DEEP_TIMEOUT: 100,  // テスト用に短く
  DEEP_MAX_BUFFER: 1024 * 1024,
  TEALUS_API_URL: 'http://localhost:3000',
  TEALUS_BOT_ID: 'test-bot',
  TEALUS_BOT_PASS: 'test-pass',
}));

// child_process をモック
// ESM では import が巻き上げられ、SUT (deep.mts) がモジュール読込時に
// `import { spawn } from 'node:child_process'` を評価するため、外側 const を factory から
// 参照すると TDZ になる (router.test.mts の openai mock と同型)。factory 内で mock を生成し
// __mockSpawn として公開、import 後に取り出す。
jest.mock('node:child_process', () => {
  const mockSpawnFn = jest.fn();
  return { execFile: jest.fn(), spawn: mockSpawnFn, __mockSpawn: mockSpawnFn };
});

// deepRegistry mock (Step 27 follow-up、sweepByWorkspacePath が timeout path で呼ばれる事を verify)
jest.mock('../../src/agents/deepRegistry.mts', () => ({
  register: jest.fn(),
  unregister: jest.fn(),
  isRunning: jest.fn(() => false),
  cancel: jest.fn(),
  sweepByWorkspacePath: jest.fn(),
}));

import * as childProcess from 'node:child_process';
const mockSpawn = (childProcess as unknown as { __mockSpawn: jest.Mock }).__mockSpawn;
import { processDeep, buildClaudeArgs, createDeepMcpConfig } from '../../src/agents/deep.mts';
import * as botApi from '../../src/lib/botApi.mts';
import * as sessionManager from '../../src/context/sessionManager.mts';
import * as deepRegistry from '../../src/agents/deepRegistry.mts';
import { logger } from '../../src/lib/logger.mts';

// 各テストで使う一時的な workspace ディレクトリ（実在させて path.join が成功するように）
const TEST_WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'tealus-deep-test-'));

afterAll(() => {
  try { fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true }); } catch {}
});

describe('Deep Agent', () => {

  describe('buildClaudeArgs', () => {
    test('基本引数を構築する', () => {
      const args = buildClaudeArgs({
        workspacePath: TEST_WORKSPACE,
      });

      expect(args).toContain('-p');
      expect(args).toContain('--dangerously-skip-permissions');
      // prompt は stdin 経由なので args には含まれない（'-' プレースホルダが入る）
      expect(args).toContain('-');
    });

    test('session_id がある場合は --resume を追加', () => {
      const args = buildClaudeArgs({
        workspacePath: TEST_WORKSPACE,
        sessionId: 'sess-123',
      });

      expect(args).toContain('--resume');
      expect(args).toContain('sess-123');
    });

    test('session_id がない場合は --resume なし', () => {
      const args = buildClaudeArgs({
        workspacePath: TEST_WORKSPACE,
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
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
      };

      // stdout にデータが来て、close で終了
      mockProcess.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from('レポートが完成しました。')), 10);
        }
      });
      mockProcess.stderr.on.mockImplementation(() => {});
      mockProcess.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 20);
        }
      });

      mockSpawn.mockReturnValueOnce(mockProcess);

      await processDeep({
        roomId: 'room1',
        prompt: 'レポートを作成して',
        workspacePath: TEST_WORKSPACE,
        agentId: 'agent1',
        sessionId: null,
      } as unknown as Parameters<typeof processDeep>[0]);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('claude'),
        expect.arrayContaining(['-p', '--dangerously-skip-permissions']),
        expect.objectContaining({ cwd: TEST_WORKSPACE })
      );

      expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('レポート'));
    });

    test('タイムアウト時はエラーメッセージを送信 + sweepByWorkspacePath が呼ばれる (Step 27 follow-up)', async () => {
      // win32 で sweepByWorkspacePath が呼ばれる事を verify
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      let closeCallback: ((code: number | null) => void) | undefined;
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn().mockImplementation(() => {
          // kill されたら close を発火
          if (closeCallback) setTimeout(() => closeCallback!(null), 5);
        }),
        killed: false,
        pid: 99999,
      };

      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});
      mockProcess.on.mockImplementation((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') closeCallback = cb;
      });

      mockSpawn.mockReturnValue(mockProcess);

      try {
        await processDeep({
          roomId: 'room1',
          prompt: 'テスト',
          workspacePath: TEST_WORKSPACE,
          agentId: 'agent1',
          sessionId: null,
        } as unknown as Parameters<typeof processDeep>[0]);

        expect(mockProcess.kill).toHaveBeenCalled();
        expect(botApi.pushMessage).toHaveBeenCalledWith('room1', expect.stringContaining('タイムアウト'));
        // #252 同型の sweep が timeout path でも呼ばれる事 (本 fix の主目的)
        expect(deepRegistry.sweepByWorkspacePath).toHaveBeenCalledWith(TEST_WORKSPACE, 'room1');
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    test('safety net path: kill 後 10s 経っても close 不発なら強制 resolve (Step 27 follow-up)', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });

      // kill されても close を発火しない (orphan claude.exe で proc が exit しない worst case)
      // exitCode / signalCode を null のままにする
      const mockProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        stdin: { write: jest.fn(), end: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(), // 何もしない、close 発火なし
        killed: false,
        exitCode: null as number | null,
        signalCode: null as string | null,
        pid: 88888,
      };

      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});
      mockProcess.on.mockImplementation(() => {}); // close 受け取らない

      mockSpawn.mockReturnValue(mockProcess);

      // processDeep は Promise を返す、safety net で resolve するはず
      const promise = processDeep({
        roomId: 'room1',
        prompt: 'テスト',
        workspacePath: TEST_WORKSPACE,
        agentId: 'agent1',
        sessionId: null,
      } as unknown as Parameters<typeof processDeep>[0]);

      // DEEP_TIMEOUT (100ms) 進める → timer callback 発動 (kill, sweep, safety net setTimeout 設定)
      await jest.advanceTimersByTimeAsync(150);
      expect(mockProcess.kill).toHaveBeenCalled();

      // この時点では safety net (10000ms) は未発火、Promise は pending
      // 更に 10000ms 進める
      await jest.advanceTimersByTimeAsync(10500);

      // Promise が resolve しているはず (safety net 発火)
      await expect(promise).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('safety net fired')
      );
      expect(deepRegistry.unregister).toHaveBeenCalledWith('room1');

      jest.useRealTimers();
    });
  });
});

/**
 * #419 ★★ 生成した MCP 設定を workspace の外に書く。
 *
 * ★ `createDeepMcpConfig` は **bot のパスワードと API キーを含む設定**を
 *   `.deep_mcp_config.json` として **workspace の中**に書いていた。
 *   filesystem MCP の root が同じ workspace なので、**`read_file` で読める**
 *   (2026-09-06 実測: 9 ルームすべてに TEALUS_PASSWORD、6 ルームに OPENAI_API_KEY)。
 *
 * ★★ #418 で読み取り系が全許可になり、**音声からも届くようになった**。
 *   → 生成先を workspace の外に移し、**古いものは消す**。
 */
describe('createDeepMcpConfig — 資格情報を workspace の外に置く (#419)', () => {
  const fsx = require('node:fs') as typeof import('node:fs');
  const pathx = require('node:path') as typeof import('node:path');
  const osx = require('node:os') as typeof import('node:os');

  let root: string;
  let workspacePath: string;

  beforeEach(() => {
    root = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'deep-cfg-'));
    workspacePath = pathx.join(root, 'agent-1', 'room-1');
    fsx.mkdirSync(workspacePath, { recursive: true });
  });
  afterEach(() => fsx.rmSync(root, { recursive: true, force: true }));

  test('★★ 生成先が workspace の外になる', () => {
    const p = createDeepMcpConfig(workspacePath, 'room-1');
    expect(fsx.existsSync(p)).toBe(true);
    // ★ workspace の下に入っていないこと (filesystem MCP の root から出す)
    expect(pathx.relative(workspacePath, p).startsWith('..')).toBe(true);
  });

  test('★★★ workspace に残っている古いものを消す (書いた分だけ守っても意味がない)', () => {
    const stale = pathx.join(workspacePath, '.deep_mcp_config.json');
    fsx.writeFileSync(stale, '{"mcpServers":{"tealus":{"env":{"TEALUS_PASSWORD":"ひみつ"}}}}');

    createDeepMcpConfig(workspacePath, 'room-1');

    expect(fsx.existsSync(stale)).toBe(false);
  });

  test('★ 中身はこれまでどおり (tealus MCP が入っている)', () => {
    const p = createDeepMcpConfig(workspacePath, 'room-1');
    const c = JSON.parse(fsx.readFileSync(p, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(c.mcpServers.tealus).toBeDefined();
  });

  test('★★ ルーム固有 MCP の ${VAR} は実体に置き換わる (子プロセスは参照を解釈しない)', () => {
    process.env.TEST_DSN_419 = 'mysql://u:p@h/db';
    fsx.writeFileSync(pathx.join(workspacePath, 'mcp_config.json'), JSON.stringify({
      mcpServers: { db: { command: 'npx', args: ['dbhub', '--dsn', '${TEST_DSN_419}'] } },
    }));

    const p = createDeepMcpConfig(workspacePath, 'room-1');
    const c = JSON.parse(fsx.readFileSync(p, 'utf8')) as { mcpServers: { db: { args: string[] } } };

    expect(c.mcpServers.db.args).toContain('mysql://u:p@h/db');
    delete process.env.TEST_DSN_419;
  });
});
