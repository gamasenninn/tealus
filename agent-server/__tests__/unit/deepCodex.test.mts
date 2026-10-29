/**
 * Deep Codex Agent (#276) ユニットテスト
 *
 * scope: prepareCodexHome / serializeMcpServersToToml / tomlEscape の core path
 * 実 codex CLI spawn は integration test 側 (skip 制御付き)。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} }));

// botApi / deepRegistry mock (= processDeepCodex は本 test では呼ばないが require チェーンで必要)
jest.mock('../../src/lib/botApi.mts', () => ({
  pushMessage: jest.fn().mockResolvedValue({}),
  pushStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/agents/deepRegistry.mts', () => ({
  register: jest.fn(),
  unregister: jest.fn(),
  cancel: jest.fn(),
  sweepByWorkspacePath: jest.fn(),
}));

import {
  prepareCodexHome,
  codexHomePath,
  writeBackCodexAuth,
  serializeMcpServersToToml,
  tomlEscape,
  buildCodexExecArgs,
  buildCodexExecEnv,
  buildDeepCodexPrompt,
  JsonlLineBuffer,
  isAgentMessageEvent,
  extractAgentMessageText,
} from '../../src/agents/deepCodex.mts';
import { writeRoomConfig } from '../../src/lib/roomConfigPaths.mts';

describe('tomlEscape', () => {
  test('plain string そのまま', () => {
    expect(tomlEscape('hello')).toBe('hello');
  });

  test('backslash → \\\\', () => {
    expect(tomlEscape('C:\\app')).toBe('C:\\\\app');
  });

  test('double quote → \\"', () => {
    expect(tomlEscape('say "hi"')).toBe('say \\"hi\\"');
  });

  test('複合: Windows path with quote', () => {
    expect(tomlEscape('C:\\foo\\"bar"')).toBe('C:\\\\foo\\\\\\"bar\\"');
  });
});

describe('serializeMcpServersToToml', () => {
  test('empty object で空文字', () => {
    expect(serializeMcpServersToToml({})).toBe('');
  });

  test('single server with command + args + env', () => {
    const toml = serializeMcpServersToToml({
      tealus: {
        command: 'npx',
        args: ['-y', 'github:foo/bar#v1'],
        env: { TEALUS_API_URL: 'http://localhost:3000', USER_ID: 'BOT' },
      },
    });
    expect(toml).toContain('[mcp_servers.tealus]');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "github:foo/bar#v1"]');
    expect(toml).toContain('[mcp_servers.tealus.env]');
    expect(toml).toContain('TEALUS_API_URL = "http://localhost:3000"');
    expect(toml).toContain('USER_ID = "BOT"');
  });

  test('required を持つ server は required = true を書く (無いものは書かない)', () => {
    const toml = serializeMcpServersToToml({
      tealus: { command: 'npx', args: [], env: {}, required: true },
      fs: { command: 'npx', args: [], env: {} },
    });
    expect(toml).toContain('[mcp_servers.tealus]\ncommand = "npx"\nargs = []\nrequired = true');
    expect(toml.match(/required/g)).toHaveLength(1);
  });

  test('startup_timeout_sec を持つ server は数として書く (無いものは書かない)', () => {
    const toml = serializeMcpServersToToml({
      tealus: { command: 'npx', args: [], env: {}, required: true, startup_timeout_sec: 60 },
      fs: { command: 'npx', args: [], env: {} },
    });
    expect(toml).toContain('required = true\nstartup_timeout_sec = 60\n');
    expect(toml.match(/startup_timeout_sec/g)).toHaveLength(1);
  });

  test('multiple servers 各 section', () => {
    const toml = serializeMcpServersToToml({
      a: { command: 'cmdA', args: [], env: {} },
      b: { command: 'cmdB', args: ['x'], env: { K: 'v' } },
    });
    expect(toml).toContain('[mcp_servers.a]');
    expect(toml).toContain('[mcp_servers.b]');
    expect(toml).toContain('command = "cmdA"');
    expect(toml).toContain('command = "cmdB"');
  });

  test('env 空 object は env section 省略', () => {
    const toml = serializeMcpServersToToml({
      a: { command: 'cmdA', args: [], env: {} },
    });
    expect(toml).not.toContain('[mcp_servers.a.env]');
  });

  test('Windows path backslash escape', () => {
    const toml = serializeMcpServersToToml({
      fs: { command: 'npx', args: ['-y', '@m/server-filesystem', 'C:\\app\\foo'] },
    });
    expect(toml).toContain('"C:\\\\app\\\\foo"');
  });
});

/**
 * ★★ #419 CODEX_HOME は **workspace の外**に置く。
 *
 * `prepareCodexHome` は `<workspace>/.codex_home/` に **auth.json (ChatGPT の OAuth トークン)** と
 * **config.toml (OPENAI_API_KEY / GOOGLE_API_KEY / TEALUS_PASSWORD)** を書いていた。
 * ★ workspace は filesystem MCP の root なので、`read_file` で**そのまま読める**。
 *
 * ★★★ `.deep_mcp_config.json` (211abea で直した) と**同じ形がもう 1 つあった**。
 *   1 つ直して満足し、同じ形をもう一度探さなかったのがこの取りこぼし。
 *   → **「コードが workspace の中に書く」ものは全部同じ扱いにする。**
 *
 * ★ `sessions/rollout-*.jsonl` (codex のセッション記録。中身に鍵が写り込む) も
 *   `.codex_home` の中なので、置き場を移せば同時に外へ出る。
 */
describe('prepareCodexHome — #419 workspace の外に置く', () => {
  let tmpRoot: string;
  let tmpWorkspace: string;
  const AGENT = 'agent-1';
  const ROOM = 'room-1';
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    // ★ 本番と同じ形にする: <WORKSPACE_ROOT>/<agentId>/<roomId>
    //   平らな temp dir で測ると、置き場の計算が本番と違っていても気づけない
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-root-'));
    tmpWorkspace = path.join(tmpRoot, AGENT, ROOM);
    fs.mkdirSync(tmpWorkspace, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  /** filesystem MCP の root (= workspace) から届く範囲 */
  const inWorkspace = () => path.join(tmpWorkspace, '.codex_home');
  /** 届かない範囲 */
  const outside = () => path.join(tmpRoot, '_codex-homes', AGENT, ROOM);

  test('★★ 置き場は <WORKSPACE_ROOT>/_codex-homes/<agentId>/<roomId> (_mcp-configs と同じ考え方)', () => {
    expect(codexHomePath(tmpWorkspace)).toBe(outside());
  });

  test('★★ workspace の中には作らない', () => {
    const home = prepareCodexHome(tmpWorkspace, {});
    expect(home).toBe(outside());
    expect(fs.existsSync(outside())).toBe(true);
    expect(fs.existsSync(inWorkspace())).toBe(false);   // ★ read_file の届く場所には無い
  });

  test('config.toml は外に生成される (mcp_servers の中身は従来どおり)', () => {
    prepareCodexHome(tmpWorkspace, {
      foo: { command: 'cmdF', args: ['a'], env: { K: 'V' } },
    });
    const tomlPath = path.join(outside(), 'config.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);
    const content = fs.readFileSync(tomlPath, 'utf8');
    expect(content).toContain('[mcp_servers.foo]');
    expect(content).toContain('command = "cmdF"');
    expect(content).toContain('K = "V"');
    expect(fs.existsSync(path.join(tmpWorkspace, '.codex_home', 'config.toml'))).toBe(false);
  });

  test('codexHomeSrc 指定で auth.json は外へ copy される', () => {
    const fakeCodex = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));
    const authContent = '{"OPENAI_API_KEY":"sub-token-fake"}';
    fs.writeFileSync(path.join(fakeCodex, 'auth.json'), authContent);

    try {
      prepareCodexHome(tmpWorkspace, {}, { codexHomeSrc: fakeCodex });
      const destAuth = path.join(outside(), 'auth.json');
      expect(fs.existsSync(destAuth)).toBe(true);
      expect(fs.readFileSync(destAuth, 'utf8')).toBe(authContent);
      expect(fs.existsSync(path.join(tmpWorkspace, '.codex_home', 'auth.json'))).toBe(false);
    } finally {
      fs.rmSync(fakeCodex, { recursive: true, force: true });
    }
  });

  test('codexHomeSrc 不在時は warn (= no throw、config.toml は生成)', () => {
    const noCodex = fs.mkdtempSync(path.join(os.tmpdir(), 'no-codex-'));
    try {
      expect(() => prepareCodexHome(tmpWorkspace, {}, { codexHomeSrc: noCodex })).not.toThrow();
      expect(fs.existsSync(path.join(outside(), 'auth.json'))).toBe(false);
      expect(fs.existsSync(path.join(outside(), 'config.toml'))).toBe(true);
    } finally {
      fs.rmSync(noCodex, { recursive: true, force: true });
    }
  });

  test('★★★ workspace に残っている古い .codex_home は消す (書く先だけ変えても既存分は読める)', () => {
    const stale = inWorkspace();
    fs.mkdirSync(path.join(stale, 'sessions', '2026', '06', '15'), { recursive: true });
    fs.writeFileSync(path.join(stale, 'auth.json'), '{"token":"old"}');
    fs.writeFileSync(path.join(stale, 'config.toml'), 'K = "V"');
    fs.writeFileSync(path.join(stale, 'sessions', '2026', '06', '15', 'rollout-x.jsonl'), '{}');

    prepareCodexHome(tmpWorkspace, {});

    // ★ sessions ごと消える (rollout-*.jsonl にも鍵が写り込む)
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(outside())).toBe(true);
  });

  test('★ 古いものが無ければ何もしない (毎回消しに行って落ちない)', () => {
    expect(() => prepareCodexHome(tmpWorkspace, {})).not.toThrow();
    expect(fs.existsSync(inWorkspace())).toBe(false);
  });
});

describe('writeBackCodexAuth (#307 codex token rotation 書き戻し)', () => {
  let codexHome: string;   // workspace 側 (.codex_home 相当)
  let srcDir: string;      // source (~/.codex 相当)

  beforeEach(() => {
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-ws-'));
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdx-src-'));
  });

  afterEach(() => {
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  test('(a) workspace auth が src と相違 (rotation 済) → 書き戻し true、src 更新', () => {
    fs.writeFileSync(path.join(srcDir, 'auth.json'), '{"tokens":{"refresh_token":"v1"}}');
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{"tokens":{"refresh_token":"v2"}}');

    const result = writeBackCodexAuth(codexHome, srcDir);
    expect(result).toBe(true);
    expect(fs.readFileSync(path.join(srcDir, 'auth.json'), 'utf8')).toBe('{"tokens":{"refresh_token":"v2"}}');
  });

  test('(b) workspace auth が src と同一 → 書き戻さず false', () => {
    const same = '{"tokens":{"refresh_token":"v1"}}';
    fs.writeFileSync(path.join(srcDir, 'auth.json'), same);
    fs.writeFileSync(path.join(codexHome, 'auth.json'), same);

    expect(writeBackCodexAuth(codexHome, srcDir)).toBe(false);
  });

  test('(c) workspace auth が存在しない → false (src 不変)', () => {
    fs.writeFileSync(path.join(srcDir, 'auth.json'), '{"tokens":{"refresh_token":"v1"}}');
    expect(writeBackCodexAuth(codexHome, srcDir)).toBe(false);
    expect(fs.readFileSync(path.join(srcDir, 'auth.json'), 'utf8')).toBe('{"tokens":{"refresh_token":"v1"}}');
  });

  test('(d) workspace auth が壊れた JSON → 書き戻さず false、src 不変 (partial write 保護)', () => {
    fs.writeFileSync(path.join(srcDir, 'auth.json'), '{"tokens":{"refresh_token":"v1"}}');
    fs.writeFileSync(path.join(codexHome, 'auth.json'), '{ broken json');

    expect(writeBackCodexAuth(codexHome, srcDir)).toBe(false);
    expect(fs.readFileSync(path.join(srcDir, 'auth.json'), 'utf8')).toBe('{"tokens":{"refresh_token":"v1"}}');
  });
});

describe('buildCodexExecArgs', () => {
  test('期待される CLI args list (= claude -p - 同型)', () => {
    const args = buildCodexExecArgs({ workspacePath: '/tmp/ws', model: 'gpt-5.4' });
    expect(args).toEqual([
      'exec', '-',
      '--json',
      '--sandbox', 'danger-full-access',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C', '/tmp/ws',
      '-m', 'gpt-5.4',
    ]);
  });

  test('Windows path も literal で含まれる', () => {
    const args = buildCodexExecArgs({ workspacePath: 'C:\\app\\room1', model: 'o4-mini' });
    expect(args).toContain('-C');
    expect(args).toContain('C:\\app\\room1');
    expect(args).toContain('o4-mini');
  });
});

describe('buildCodexExecEnv', () => {
  test('useSubscription=true で OPENAI_API_KEY を除外', () => {
    const env = buildCodexExecEnv({
      codexHomePath: '/tmp/.codex_home',
      openaiApiKey: 'sk-test-12345',
      useSubscription: true,
      baseEnv: { OPENAI_API_KEY: 'sk-existing', OTHER: 'x' },
    });
    expect(env.CODEX_HOME).toBe('/tmp/.codex_home');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OTHER).toBe('x');
  });

  test('useSubscription=false + openaiApiKey set で OPENAI_API_KEY を env で渡す', () => {
    const env = buildCodexExecEnv({
      codexHomePath: '/tmp/.codex_home',
      openaiApiKey: 'sk-test-12345',
      useSubscription: false,
      baseEnv: { OTHER: 'x' },
    });
    expect(env.OPENAI_API_KEY).toBe('sk-test-12345');
  });

  test('useSubscription=true で baseEnv に key が無くても OK', () => {
    const env = buildCodexExecEnv({
      codexHomePath: '/tmp/.codex_home',
      useSubscription: true,
      baseEnv: { OTHER: 'y' },
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_HOME).toBe('/tmp/.codex_home');
  });
});

describe('JsonlLineBuffer', () => {
  test('完成行 1 件 parse', () => {
    const buf = new JsonlLineBuffer();
    const events = buf.append('{"type":"a"}\n');
    expect(events).toEqual([{ type: 'a' }]);
  });

  test('改行跨ぎ chunk を正しく結合 parse', () => {
    const buf = new JsonlLineBuffer();
    const e1 = buf.append('{"type":"');
    expect(e1).toEqual([]);
    const e2 = buf.append('a"}\n{"type":');
    expect(e2).toEqual([{ type: 'a' }]);
    const e3 = buf.append('"b"}\n');
    expect(e3).toEqual([{ type: 'b' }]);
  });

  test('複数行 chunk を一括 parse', () => {
    const buf = new JsonlLineBuffer();
    const events = buf.append('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n');
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });

  test('空行 skip', () => {
    const buf = new JsonlLineBuffer();
    const events = buf.append('{"a":1}\n\n\n{"b":2}\n');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test('invalid JSON は __parseError マーカーで返す', () => {
    const buf = new JsonlLineBuffer();
    const events = buf.append('not json\n{"valid":1}\n');
    expect(events).toHaveLength(2);
    expect(events[0].__parseError).toBe(true);
    expect(events[0].raw).toBe('not json');
    expect(events[1]).toEqual({ valid: 1 });
  });

  test('flush で 残 buffer を最終 parse', () => {
    const buf = new JsonlLineBuffer();
    buf.append('{"a":1}\n{"b":2}'); // 最後 newline なし
    const flushed = buf.flush();
    expect(flushed).toEqual([{ b: 2 }]);
  });
});

describe('isAgentMessageEvent + extractAgentMessageText', () => {
  test('item.completed type=agent_message を識別', () => {
    const event = { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } };
    expect(isAgentMessageEvent(event)).toBe(true);
    expect(extractAgentMessageText(event)).toBe('hello');
  });

  test('直接 type=agent_message も識別 (= 別 schema 兼用)', () => {
    const event = { type: 'agent_message', text: 'hi' };
    expect(isAgentMessageEvent(event)).toBe(true);
    expect(extractAgentMessageText(event)).toBe('hi');
  });

  test('他 event type は false', () => {
    expect(isAgentMessageEvent({ type: 'turn.completed' })).toBe(false);
    expect(isAgentMessageEvent({ type: 'item.completed', item: { type: 'mcp_tool_call' } })).toBe(false);
  });
});

/**
 * #567 Deep codex の失敗の原因をログに残す。
 * ★ 09-21 に Deep が道具を使えずに謝って終わったが、標準出力は返事しか拾わず、終了コード 0 なので標準エラーも捨てていて、原因が残らなかった
 */
describe('describeCodexEvent (#567)', () => {
  const { describeCodexEvent } = require('../../src/agents/deepCodex.mts') as typeof import('../../src/agents/deepCodex.mts');
  test('★ error / turn.failed のイベントは warn で残す', () => {
    expect(describeCodexEvent({ type: 'error', message: 'mcp startup timeout' })).toMatchObject({ level: 'warn' });
    expect(describeCodexEvent({ type: 'turn.failed', error: { message: 'boom' } })!.line).toMatch(/turn\.failed.*boom/);
  });
  test('★ 道具の呼び出しの結果は 1 行 (失敗は warn)', () => {
    expect(describeCodexEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'tealus', tool: 'get_messages', status: 'completed' } }))
      .toMatchObject({ level: 'info' });
    expect(describeCodexEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'tealus', tool: 'get_messages', status: 'failed', error: { message: 'x' } } }))
      .toMatchObject({ level: 'warn' });
  });
  test('★ 資料の一覧の道具が「無い」(-32601) で失敗したのは想定どおり = info (10-16: codex 0.162.1 から Deep のたびに warn 3 行)', () => {
    for (const tool of ['list_mcp_resources', 'list_mcp_resource_templates']) {
      const d = describeCodexEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'tealus', tool, status: 'failed',
        error: { message: 'resources/list failed: resources/list failed for `tealus`: Mcp error: -32601: Method not found' } } });
      expect(d).toMatchObject({ level: 'info' });
      expect(d!.line).toContain('資料を持たない');
    }
  });
  test('★ 資料の道具でも、ほかの失敗は warn のまま', () => {
    expect(describeCodexEvent({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'tealus', tool: 'list_mcp_resources', status: 'failed', error: { message: 'timeout' } } }))
      .toMatchObject({ level: 'warn' });
  });
  test('返事や途中経過など、ほかのイベントは残さない (null)', () => {
    expect(describeCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } })).toBeNull();
    expect(describeCodexEvent({ type: 'turn.started' })).toBeNull();
  });
});

describe('unexpectedStderr (10-16)', () => {
  const { unexpectedStderr } = require('../../src/agents/deepCodex.mts') as typeof import('../../src/agents/deepCodex.mts');
  const expected = [
    '2026-10-15T15:41:27.139075Z ERROR codex_core::tools::router: error=resources/templates/list failed: resources/templates/list failed for `tealus`: Mcp error: -32601: Method not found',
    '2026-10-15T15:41:27.155895Z ERROR codex_core::tools::router: error=resources/list failed: resources/list failed for `tealus`: Mcp error: -32601: Method not found',
  ];
  test('★ 資料の一覧の「無い」だけなら空 (= 警告を出さない)', () => {
    expect(unexpectedStderr(expected.join('\n'))).toBe('');
  });
  test('★ ほかの行は残す (道具が起動しなかった理由などは #567 のとおり出す)', () => {
    expect(unexpectedStderr([...expected, 'ERROR mcp startup failed: tealus'].join('\n'))).toBe('ERROR mcp startup failed: tealus');
  });
});

// ★ 改善ループ 15 回目: Deep は使用量を記録していなかった (次に動いたとき、費用が言えない)
describe('describeCodexEvent — 使用量', () => {
  const { describeCodexEvent } = require('../../src/agents/deepCodex.mts') as typeof import('../../src/agents/deepCodex.mts');
  it('turn.completed の usage を 1 行に残す (cached・reasoning も)', () => {
    const r = describeCodexEvent({ type: 'turn.completed', usage: { input_tokens: 50000, cached_input_tokens: 40000, output_tokens: 900, reasoning_output_tokens: 200 } } as never);
    expect(r).toEqual({ level: 'info', line: '[DeepCodex] turn completed, usage: input=50000 cached=40000 output=900 reasoning=200' });
  });
});


/**
 * ★ 2026-10-27 小野さん判断 (承認 11): ダッシュボードの「Deep の指示」(部屋の CLAUDE.md) は、claude の Deep にしか渡っていなかった。
 *   codex は cwd の AGENTS.md しか読まず、本番の Deep は codex なので、書いた指示が効いていなかった
 */
describe('buildDeepCodexPrompt — 部屋の Deep の指示を codex にも渡す', () => {
  let root: string;
  let ws: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-codex-prompt-'));
    ws = path.join(root, 'agent-1', 'room-1');
    fs.mkdirSync(ws, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('★★ 部屋の Deep の指示があれば、依頼の前に付ける', () => {
    writeRoomConfig(ws, 'CLAUDE.md', '# 指示\n売上は入金済みで数える');
    const out = buildDeepCodexPrompt(ws, '今月の売上は？');
    expect(out.indexOf('売上は入金済みで数える')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('売上は入金済みで数える')).toBeLessThan(out.indexOf('今月の売上は？'));
  });

  test('指示が無ければ依頼そのまま', () => {
    expect(buildDeepCodexPrompt(ws, '今月の売上は？')).toBe('今月の売上は？');
  });

  test('★ workspace の中の CLAUDE.md (AI が書ける場所) は読まない (G-1 と同じ)', () => {
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), 'AI が置いた指示');
    expect(buildDeepCodexPrompt(ws, '依頼')).toBe('依頼');
  });
});

// ★ 2026-10-29 改善ループ 20 回目: 委譲の「このルームに投稿しないで」(dispatcher の noPostPrefix) は依頼文の先頭に置いていたが、
//   部屋の Deep の指示を付けるようになってその後ろに回り、埋もれた。前置きは部屋の指示より前に置く
describe('buildDeepCodexPrompt — 前置き (委譲の決まり)', () => {
  let root: string;
  let ws: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-codex-preamble-'));
    ws = path.join(root, 'agent-1', 'room-1');
    fs.mkdirSync(ws, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('★ 前置き → 部屋の指示 → 依頼 の順', () => {
    writeRoomConfig(ws, 'CLAUDE.md', '部屋の指示');
    const out = buildDeepCodexPrompt(ws, '依頼', '**重要**: 投稿しない\n\n');
    expect(out.indexOf('投稿しない')).toBeLessThan(out.indexOf('部屋の指示'));
    expect(out.indexOf('部屋の指示')).toBeLessThan(out.indexOf('依頼'));
  });

  test('部屋の指示が無ければ 前置き + 依頼', () => {
    expect(buildDeepCodexPrompt(ws, '依頼', '前置き\n\n')).toBe('前置き\n\n依頼');
  });
});
