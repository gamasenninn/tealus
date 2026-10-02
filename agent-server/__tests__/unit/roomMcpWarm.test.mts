/**
 * 会話モードが始まるまでの待ち (2026-10-02)
 *
 * ★ 実測: 会話の開始が 0.9〜2.3 秒か、18〜25 秒かに分かれていた (9 セッション中 4 本が遅い)。
 *   遅い 1 回目の中身は MCP の起動を**順番に**待っていた: filesystem 8.8 秒 → tealus 16.5 秒 → tavily 3.4 秒
 * ★ しかも同時に 2 回呼ばれると共有 MCP を**二重に起こし**、先に作った方は閉じられずに残っていた
 *   (13:56:24 に「tealus MCP connected (shared global)」が 2 回)
 * ここで固定する:
 *   1. 共有 MCP を起こしている最中の呼び出しは、同じ起動を待つ (二重に起こさない)
 *   2. warmSharedGlobal で先に起こしておける (agent-server の起動時に裏で呼ぶ)
 *   3. 冷えた部屋では、filesystem と共有 MCP を同時に起こす (順番に待たない)
 */
const events: string[] = [];
const constructed: string[] = [];

jest.mock('@openai/agents', () => ({
  MCPServerStdio: jest.fn().mockImplementation((opts: { name: string }) => {
    constructed.push(opts.name);
    return {
      name: opts.name,
      connect: jest.fn(async () => {
        events.push(`start:${opts.name}`);
        await new Promise((r) => setTimeout(r, 30));
        events.push(`end:${opts.name}`);
      }),
      close: jest.fn(async () => {}),
      listTools: jest.fn(async () => []),
    };
  }),
}));

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));

jest.mock('../../src/config.mts', () => ({
  MCP_CACHE_TTL: 60_000,
  MCP_SWEEP_INTERVAL: 60_000,
  TEALUS_BOT_ID: 'bot',
  TEALUS_BOT_PASS: 'pass',
  TEALUS_API_URL: 'http://localhost:3000',
}));

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  events.length = 0;
  constructed.length = 0;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-warm-'));
  jest.resetModules();
});
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const tealusCount = () => constructed.filter((n) => n === 'tealus').length;

describe('共有 MCP の起こし方', () => {
  test('★★ 同時に 2 回呼ばれても、共有 MCP は 1 回しか起こさない', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await Promise.all([
      getOrCreateRoomMcp('agent', 'room1', tmpDir),
      getOrCreateRoomMcp('agent', 'room2', tmpDir),
    ]);
    expect(tealusCount()).toBe(1);
  });

  test('★ 同じ部屋に同時に 2 回呼ばれても、部屋の filesystem も 1 回だけ', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await Promise.all([
      getOrCreateRoomMcp('agent', 'room1', tmpDir),
      getOrCreateRoomMcp('agent', 'room1', tmpDir),
    ]);
    expect(constructed.filter((n) => n === 'tealus-workspace-fs')).toHaveLength(1);
    expect(tealusCount()).toBe(1);
  });

  test('★ warmSharedGlobal で先に起こしておけば、部屋の初回は共有 MCP を起こし直さない', async () => {
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    expect(tealusCount()).toBe(1);
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    expect(tealusCount()).toBe(1);
  });

  test('★ 冷えた部屋では filesystem と共有 MCP を同時に起こす (順番に待たない)', async () => {
    const { getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    const firstEnd = events.findIndex((e) => e.startsWith('end:'));
    const starts = events.slice(0, firstEnd).filter((e) => e.startsWith('start:'));
    expect(starts).toEqual(expect.arrayContaining(['start:tealus-workspace-fs', 'start:tealus']));
  });

  test('closeAllRoomMcp の後は、もう一度起こせる', async () => {
    const { warmSharedGlobal, closeAllRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    await closeAllRoomMcp();
    await warmSharedGlobal();
    expect(tealusCount()).toBe(2);
  });
});
