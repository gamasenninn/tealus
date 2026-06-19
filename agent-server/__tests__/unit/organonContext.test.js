/**
 * Organon Context (#276 follow-up) unit test
 *
 * scope: organon repo (= tmp fixture) からの polyseme.sql_mapping 抽出 + prompt block 整形
 * + ORGANON_INJECT env opt-in (#304、default OFF) + silent skip 動作 + 起動時 state ログ
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

const logger = require('../../src/lib/logger');
const {
  loadOrganonPolysemeForPrompt,
  loadSqlMappingEntries,
  isAvailable,
  logOrganonInjectState,
} = require('../../src/lib/organonContext');

/**
 * tmp organon repo fixture を作成
 * structure: <tmpDir>/entries/polyseme/<term>.yaml
 */
function setupFixture(entries) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-ctx-test-'));
  const polysemeDir = path.join(tmpDir, 'entries', 'polyseme');
  fs.mkdirSync(polysemeDir, { recursive: true });
  for (const [filename, content] of Object.entries(entries)) {
    fs.writeFileSync(path.join(polysemeDir, filename), content);
  }
  return tmpDir;
}

function cleanupFixture(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

describe('isAvailable', () => {
  test('entries/polyseme 存在で true', () => {
    const tmpDir = setupFixture({ 'foo.yaml': 'term: foo\n' });
    try {
      expect(isAvailable(tmpDir)).toBe(true);
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('organon path 不在で false', () => {
    expect(isAvailable('/nonexistent/path')).toBe(false);
  });

  test('entries/polyseme dir 不在で false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-ctx-test-'));
    try {
      expect(isAvailable(tmpDir)).toBe(false);
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('loadSqlMappingEntries', () => {
  test('sql_mapping 持つ entries だけ抽出', () => {
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nkind: polyseme\nsql_mapping:\n  db_column: 店長確認\n  db_value: OK\n',
      '売上.yaml': 'term: 売上\nkind: polyseme\nsql_mapping:\n  interpretations:\n    - A: 全件\n',
      'お客様.yaml': 'term: お客様\nkind: polyseme\ncontext_morning:\n  gloss: 顧客\n', // sql_mapping なし
      '体制.yaml': 'term: 体制\nkind: polyseme\ncontext_morning:\n  gloss: 人員\n', // sql_mapping なし
    });
    try {
      const entries = loadSqlMappingEntries(tmpDir);
      const terms = entries.map((e) => e.term).sort();
      expect(terms).toEqual(['売上', '納品']);
      // raw content 含まれる
      const noukaiEntry = entries.find((e) => e.term === '納品');
      expect(noukaiEntry.content).toContain('sql_mapping:');
      expect(noukaiEntry.content).toContain('db_column: 店長確認');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('organon 不在で 空 array', () => {
    expect(loadSqlMappingEntries('/nonexistent/path')).toEqual([]);
  });

  test('全 entries に sql_mapping なしで 空 array', () => {
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\nkind: polyseme\n',
      'bar.yaml': 'term: bar\ncontext: x\n',
    });
    try {
      expect(loadSqlMappingEntries(tmpDir)).toEqual([]);
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('.yaml 以外の file は無視', () => {
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\nsql_mapping:\n  x: y\n',
      'README.md': '# readme with sql_mapping: line',
      'bar.txt': 'sql_mapping: y',
    });
    try {
      const entries = loadSqlMappingEntries(tmpDir);
      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('foo');
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('loadOrganonPolysemeForPrompt (opt-in、#304)', () => {
  const originalInject = process.env.ORGANON_INJECT;
  const originalOld = process.env.INJECT_ORGANON_POLYSEME;

  afterEach(() => {
    if (originalInject === undefined) delete process.env.ORGANON_INJECT;
    else process.env.ORGANON_INJECT = originalInject;
    if (originalOld === undefined) delete process.env.INJECT_ORGANON_POLYSEME;
    else process.env.INJECT_ORGANON_POLYSEME = originalOld;
  });

  test('ORGANON_INJECT=true + entries あり → prompt block 整形 (= ## 業務 DB 検索時の参考 含む)', () => {
    process.env.ORGANON_INJECT = 'true';
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  db_column: 店長確認\n  db_value: OK\n',
    });
    try {
      const prompt = loadOrganonPolysemeForPrompt({ organonPath: tmpDir });
      expect(prompt).toContain('## 業務 DB 検索時の参考');
      expect(prompt).toContain('### 納品');
      expect(prompt).toContain('```yaml');
      expect(prompt).toContain('db_column: 店長確認');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('ORGANON_INJECT 未設定 (default) で 空文字 (= opt-in OFF)', () => {
    delete process.env.ORGANON_INJECT;
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  x: y\n',
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('ORGANON_INJECT=false で 空文字', () => {
    process.env.ORGANON_INJECT = 'false';
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  x: y\n',
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('旧 INJECT_ORGANON_POLYSEME=true は無視 (= opt-in は ORGANON_INJECT のみ、fallback なし)', () => {
    delete process.env.ORGANON_INJECT;
    process.env.INJECT_ORGANON_POLYSEME = 'true';
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\nsql_mapping:\n  x: y\n',
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('ORGANON_INJECT=true でも organon 不在で 空文字 (= silent skip、agent prompt 影響なし)', () => {
    process.env.ORGANON_INJECT = 'true';
    expect(loadOrganonPolysemeForPrompt({ organonPath: '/nonexistent' })).toBe('');
  });

  test('ORGANON_INJECT=true でも sql_mapping 持つ entries 0 件で 空文字', () => {
    process.env.ORGANON_INJECT = 'true';
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\ncontext: x\n', // sql_mapping なし
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('logOrganonInjectState (起動時 state ログ、#304)', () => {
  const originalInject = process.env.ORGANON_INJECT;

  afterEach(() => {
    if (originalInject === undefined) delete process.env.ORGANON_INJECT;
    else process.env.ORGANON_INJECT = originalInject;
    logger.info.mockClear();
  });

  test('ORGANON_INJECT=true で ON ログ (= entries 数を含む)', () => {
    process.env.ORGANON_INJECT = 'true';
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  x: y\n',
      'foo.yaml': 'term: foo\ncontext: x\n', // sql_mapping なし → entries に含まれない
    });
    try {
      logOrganonInjectState({ organonPath: tmpDir });
      const msg = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(msg).toContain('organon inject: ON');
      expect(msg).toContain('entries=1');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('ORGANON_INJECT 未設定で OFF ログ', () => {
    delete process.env.ORGANON_INJECT;
    logOrganonInjectState();
    const msg = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('organon inject: OFF');
  });
});
