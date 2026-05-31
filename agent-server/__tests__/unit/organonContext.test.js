/**
 * Organon Context (#276 follow-up) unit test
 *
 * scope: organon repo (= tmp fixture) からの polyseme.sql_mapping 抽出 + prompt block 整形
 * + INJECT_ORGANON_POLYSEME env toggle + silent skip 動作
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

const {
  loadOrganonPolysemeForPrompt,
  loadSqlMappingEntries,
  isAvailable,
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

describe('loadOrganonPolysemeForPrompt', () => {
  const originalInject = process.env.INJECT_ORGANON_POLYSEME;

  afterEach(() => {
    if (originalInject === undefined) delete process.env.INJECT_ORGANON_POLYSEME;
    else process.env.INJECT_ORGANON_POLYSEME = originalInject;
  });

  test('entries あり時、prompt block 整形 (= ## 業務 DB 検索時の参考 含む)', () => {
    delete process.env.INJECT_ORGANON_POLYSEME;
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

  test('INJECT_ORGANON_POLYSEME=false で 空文字', () => {
    process.env.INJECT_ORGANON_POLYSEME = 'false';
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  x: y\n',
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('organon 不在で 空文字 (= silent skip、agent prompt 影響なし)', () => {
    delete process.env.INJECT_ORGANON_POLYSEME;
    expect(loadOrganonPolysemeForPrompt({ organonPath: '/nonexistent' })).toBe('');
  });

  test('sql_mapping 持つ entries 0 件で 空文字', () => {
    delete process.env.INJECT_ORGANON_POLYSEME;
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\ncontext: x\n', // sql_mapping なし
    });
    try {
      expect(loadOrganonPolysemeForPrompt({ organonPath: tmpDir })).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('INJECT_ORGANON_POLYSEME=true 明示でも default と同動作', () => {
    process.env.INJECT_ORGANON_POLYSEME = 'true';
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\nsql_mapping:\n  x: y\n',
    });
    try {
      const prompt = loadOrganonPolysemeForPrompt({ organonPath: tmpDir });
      expect(prompt).toContain('### foo');
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});
