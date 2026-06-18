/**
 * Deep Codex Agent (#276) ユニットテスト
 *
 * scope: prepareCodexHome / serializeMcpServersToToml / tomlEscape の core path
 * 実 codex CLI spawn は integration test 側 (skip 制御付き)。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

// botApi / deepRegistry mock (= processDeepCodex は本 test では呼ばないが require チェーンで必要)
jest.mock('../../src/lib/botApi', () => ({
  pushMessage: jest.fn().mockResolvedValue({}),
  pushStatus: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/agents/deepRegistry', () => ({
  register: jest.fn(),
  unregister: jest.fn(),
  cancel: jest.fn(),
  sweepByWorkspacePath: jest.fn(),
}));

const {
  prepareCodexHome,
  writeBackCodexAuth,
  serializeMcpServersToToml,
  tomlEscape,
  buildCodexExecArgs,
  buildCodexExecEnv,
  JsonlLineBuffer,
  isAgentMessageEvent,
  extractAgentMessageText,
} = require('../../src/agents/deepCodex');

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

describe('prepareCodexHome', () => {
  let tmpWorkspace;
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  test('.codex_home dir 作成', () => {
    prepareCodexHome(tmpWorkspace, {});
    expect(fs.existsSync(path.join(tmpWorkspace, '.codex_home'))).toBe(true);
  });

  test('config.toml 生成 (mcp_servers content 確認)', () => {
    prepareCodexHome(tmpWorkspace, {
      foo: { command: 'cmdF', args: ['a'], env: { K: 'V' } },
    });
    const tomlPath = path.join(tmpWorkspace, '.codex_home', 'config.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);
    const content = fs.readFileSync(tomlPath, 'utf8');
    expect(content).toContain('[mcp_servers.foo]');
    expect(content).toContain('command = "cmdF"');
    expect(content).toContain('K = "V"');
  });

  test('codexHomeSrc 指定で auth.json copy', () => {
    const fakeCodex = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));
    const authContent = '{"OPENAI_API_KEY":"sub-token-fake"}';
    fs.writeFileSync(path.join(fakeCodex, 'auth.json'), authContent);

    try {
      prepareCodexHome(tmpWorkspace, {}, { codexHomeSrc: fakeCodex });
      const destAuth = path.join(tmpWorkspace, '.codex_home', 'auth.json');
      expect(fs.existsSync(destAuth)).toBe(true);
      expect(fs.readFileSync(destAuth, 'utf8')).toBe(authContent);
    } finally {
      fs.rmSync(fakeCodex, { recursive: true, force: true });
    }
  });

  test('codexHomeSrc 不在時は warn (= no throw、config.toml は生成)', () => {
    const noCodex = fs.mkdtempSync(path.join(os.tmpdir(), 'no-codex-'));
    // codexHomeSrc dir は作るが auth.json は不在
    try {
      expect(() => prepareCodexHome(tmpWorkspace, {}, { codexHomeSrc: noCodex })).not.toThrow();
      const destAuth = path.join(tmpWorkspace, '.codex_home', 'auth.json');
      expect(fs.existsSync(destAuth)).toBe(false);
      // config.toml は生成される
      const tomlPath = path.join(tmpWorkspace, '.codex_home', 'config.toml');
      expect(fs.existsSync(tomlPath)).toBe(true);
    } finally {
      fs.rmSync(noCodex, { recursive: true, force: true });
    }
  });
});

describe('writeBackCodexAuth (#307 codex token rotation 書き戻し)', () => {
  let codexHome;   // workspace 側 (.codex_home 相当)
  let srcDir;      // source (~/.codex 相当)

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
