/**
 * 共有グローバルの tealus が起動時に起きなかったら、あとで起こし直す (改善ループ 33)
 *
 * ★ 2026-10-31 16:54 と 17:10 の起動で、tealus MCP の接続が失敗した (npx のキャッシュ切れ)。
 *   共有グローバルは最初の結果を一生返すので、キャッシュを直したあとも会話モードと Light v1 は
 *   tealus の道具が無いまま動き続けた (「Shared global: 1 servers」、再起動するまで直らない)
 * ここで固定する:
 *   1. 起動時に tealus が起きなかったら、1 分たってからの呼び出しで起こし直す (★ 呼び出し側は待たない。
 *      待たせると、失敗が続く間は会話モードの開始が最大 30 秒止まる。入るのは起こし直しが済んだ次の呼び出しから)
 *   2. 1 分以内は起こし直さない (失敗が続くとき、呼ぶたびに 30 秒待たせない)
 *   3. 起こし直しても tealus は 1 本だけ (二重に起こさない)
 *   4. 起こし直しの最中に止めても、起こしたての tealus を閉じ忘れない
 */
const constructed: string[] = [];
let tealusFailuresLeft = 0;

jest.mock('@openai/agents', () => ({
  MCPServerStdio: jest.fn().mockImplementation((opts: { name: string }) => {
    constructed.push(opts.name);
    return {
      name: opts.name,
      connect: jest.fn(async () => {
        if (opts.name === 'tealus' && tealusFailuresLeft > 0) {
          tealusFailuresLeft--;
          throw new Error('MCP error -32000: Connection closed');
        }
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
let now: number;

beforeEach(() => {
  constructed.length = 0;
  tealusFailuresLeft = 0;
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-retry-'));
  jest.resetModules();
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const names = (servers: { name: string }[]) => servers.map((s) => s.name);
const tealusIn = (servers: { name: string }[]) => names(servers).filter((n) => n === 'tealus').length;
const settle = () => new Promise((r) => setImmediate(r));

describe('共有グローバルの tealus の起こし直し', () => {
  test('★★ 起動時に失敗しても、1 分たてば起こし直し、済んだあとの呼び出しで tealus が入る', async () => {
    tealusFailuresLeft = 1;
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    expect(tealusIn(await getOrCreateRoomMcp('agent', 'room1', tmpDir))).toBe(0);

    now += 61_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);   // ★ 待たない (起こし直しを始めるだけ)
    await settle();
    expect(tealusIn(await getOrCreateRoomMcp('agent', 'room1', tmpDir))).toBe(1);
  });

  test('★★ 起こし直しを呼び出し側は待たない', async () => {
    tealusFailuresLeft = 1;
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 61_000;
    let release!: () => void;
    const { MCPServerStdio } = require('@openai/agents');
    (MCPServerStdio as jest.Mock).mockImplementationOnce((opts: { name: string }) => {
      constructed.push(opts.name);
      return { name: opts.name, connect: () => new Promise<void>((r) => { release = r; }), close: jest.fn(async () => {}), listTools: jest.fn(async () => []) };
    });
    const servers = await getOrCreateRoomMcp('agent', 'room1', tmpDir);   // 起こし直しが終わらなくても返る
    expect(tealusIn(servers)).toBe(0);
    release();
  });

  test('★ 1 分以内は起こし直さない', async () => {
    tealusFailuresLeft = 1;
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 30_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    expect(constructed.filter((n) => n === 'tealus')).toHaveLength(1);
  });

  test('★ 起こし直しにも失敗したら、また 1 分あけてから試す', async () => {
    tealusFailuresLeft = 2;
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 61_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    await settle();
    expect(tealusIn(await getOrCreateRoomMcp('agent', 'room1', tmpDir))).toBe(0);
    now += 30_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    expect(constructed.filter((n) => n === 'tealus')).toHaveLength(2);
    now += 31_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    await settle();
    expect(tealusIn(await getOrCreateRoomMcp('agent', 'room1', tmpDir))).toBe(1);
  });

  test('★ 同時に呼ばれても、起こし直しは 1 回だけ・tealus は 1 本だけ', async () => {
    tealusFailuresLeft = 1;
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 61_000;
    await Promise.all([
      getOrCreateRoomMcp('agent', 'room1', tmpDir),
      getOrCreateRoomMcp('agent', 'room2', tmpDir),
    ]);
    await settle();
    const [a, b] = await Promise.all([
      getOrCreateRoomMcp('agent', 'room1', tmpDir),
      getOrCreateRoomMcp('agent', 'room2', tmpDir),
    ]);
    expect(constructed.filter((n) => n === 'tealus')).toHaveLength(2);
    expect(tealusIn(a)).toBe(1);
    expect(tealusIn(b)).toBe(1);
  });

  test('起動時に成功していれば、起こし直さない', async () => {
    const { warmSharedGlobal, getOrCreateRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 61_000;
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    expect(constructed.filter((n) => n === 'tealus')).toHaveLength(1);
  });

  test('★ 起こし直しの最中に止めても、起こしたての tealus を閉じる', async () => {
    tealusFailuresLeft = 1;
    const { warmSharedGlobal, getOrCreateRoomMcp, closeAllRoomMcp } = require('../../src/mcp/roomMcpManager');
    await warmSharedGlobal();
    now += 61_000;
    let release!: () => void;
    const closed = jest.fn(async () => {});
    const { MCPServerStdio } = require('@openai/agents');
    (MCPServerStdio as jest.Mock).mockImplementationOnce((opts: { name: string }) => {
      constructed.push(opts.name);
      return { name: opts.name, connect: () => new Promise<void>((r) => { release = r; }), close: closed, listTools: jest.fn(async () => []) };
    });
    await getOrCreateRoomMcp('agent', 'room1', tmpDir);
    const stopping = closeAllRoomMcp();
    release();
    await stopping;
    await settle();
    expect(closed).toHaveBeenCalled();
  });
});
