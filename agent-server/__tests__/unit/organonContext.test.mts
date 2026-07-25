/**
 * Organon Context (#276 follow-up) unit test
 *
 * scope: organon repo (= tmp fixture) からの polyseme.sql_mapping 抽出 + prompt block 整形
 * + ORGANON_INJECT env opt-in (#304、default OFF) + silent skip 動作 + 起動時 state ログ
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

import { logger } from '../../src/lib/logger.mts';
import {
  loadOrganonPolysemeForPrompt,
  loadSqlMappingEntries,
  extractSqlMappingBlock,
  isAvailable,
  logOrganonInjectState,
} from '../../src/lib/organonContext.mts';

/**
 * tmp organon repo fixture を作成
 * structure: <tmpDir>/entries/polyseme/<term>.yaml
 */
function setupFixture(entries: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-ctx-test-'));
  const polysemeDir = path.join(tmpDir, 'entries', 'polyseme');
  fs.mkdirSync(polysemeDir, { recursive: true });
  for (const [filename, content] of Object.entries(entries)) {
    fs.writeFileSync(path.join(polysemeDir, filename), content);
  }
  return tmpDir;
}

function cleanupFixture(tmpDir: string): void {
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
      const noukaiEntry = entries.find((e) => e.term === '納品')!;
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

describe('extractSqlMappingBlock (#349 Tier 1: 散文を落とし sql_mapping ブロックのみ)', () => {
  test('sql_mapping ブロックだけ抽出し、次の top-level key で止まる (散文除外)', () => {
    const yaml = [
      'term: 仕切',
      'description: |',
      '  長い散文の説明',
      '  多義の解説がここに続く',
      'sql_mapping:',
      '  primary:',
      '    table: hksdb.V_出品管理',
      '    field: 仕切書No',
      '  format_distribution_observed:',
      '    正規: |',
      '      5桁-枝番',
      'hazard: |',
      '  ハザードの散文',
      'links:',
      '  - 売上',
    ].join('\n');
    const block = extractSqlMappingBlock(yaml);
    // sql_mapping の中身は保持
    expect(block).toContain('sql_mapping:');
    expect(block).toContain('table: hksdb.V_出品管理');
    expect(block).toContain('field: 仕切書No');
    expect(block).toContain('5桁-枝番'); // ブロックスカラ内の grounding-critical も保持
    // 散文(description/hazard/links)と他 top-level は含まない
    expect(block).not.toContain('term: 仕切');
    expect(block).not.toContain('長い散文の説明');
    expect(block).not.toContain('多義の解説');
    expect(block).not.toContain('ハザードの散文');
    expect(block).not.toContain('- 売上');
  });

  test('sql_mapping が最後の top-level key なら末尾まで取り、末尾空行は trim', () => {
    const yaml = 'term: X\nsql_mapping:\n  table: t\n  field: f\n\n';
    const block = extractSqlMappingBlock(yaml);
    expect(block).toContain('sql_mapping:');
    expect(block).toContain('table: t');
    expect(block.endsWith('field: f')).toBe(true);
    expect(block).not.toContain('term: X');
  });

  test('sql_mapping 無しは空文字', () => {
    expect(extractSqlMappingBlock('term: X\ndescription: 散文だけ\n')).toBe('');
  });
});

describe('loadSqlMappingEntries は Tier 1 で sql_mapping ブロックのみ返す (#349)', () => {
  test('散文(description/hazard)を除外して sql_mapping だけ content に載る', () => {
    const tmpDir = setupFixture({
      '仕切.yaml': 'term: 仕切\ndescription: 長い散文の説明\nsql_mapping:\n  table: hksdb.V_出品管理\n  field: 仕切書No\nhazard: 危険な散文\n',
    });
    try {
      const entries = loadSqlMappingEntries(tmpDir);
      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('仕切');
      expect(entries[0].content).toContain('sql_mapping:');
      expect(entries[0].content).toContain('table: hksdb.V_出品管理');
      expect(entries[0].content).not.toContain('長い散文の説明');
      expect(entries[0].content).not.toContain('危険な散文');
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

describe('logOrganonInjectState (起動時 state ログ、#304 / #347 warn 化)', () => {
  const originalInject = process.env.ORGANON_INJECT;

  afterEach(() => {
    if (originalInject === undefined) delete process.env.ORGANON_INJECT;
    else process.env.ORGANON_INJECT = originalInject;
    (logger.info as jest.Mock).mockClear();
    (logger.warn as jest.Mock).mockClear();
  });

  const infoMsg = (): string =>
    (logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('\n');
  const warnMsg = (): string =>
    (logger.warn as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('\n');

  test('ORGANON_INJECT=true + entries あり → ON info ログ (= entries 数を含む)、warn なし', () => {
    process.env.ORGANON_INJECT = 'true';
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nsql_mapping:\n  x: y\n',
      'foo.yaml': 'term: foo\ncontext: x\n', // sql_mapping なし → entries に含まれない
    });
    try {
      logOrganonInjectState({ organonPath: tmpDir });
      expect(infoMsg()).toContain('organon inject: ON');
      expect(infoMsg()).toContain('entries=1');
      expect(logger.warn as jest.Mock).not.toHaveBeenCalled();
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('ORGANON_INJECT 未設定で OFF info ログ、warn なし', () => {
    delete process.env.ORGANON_INJECT;
    logOrganonInjectState();
    expect(infoMsg()).toContain('organon inject: OFF');
    expect(logger.warn as jest.Mock).not.toHaveBeenCalled();
  });

  // #347 ①: ORGANON_INJECT=true なのに organon 不在 = silent degrade。
  // migration-check 同型で loud warn を出す (FATAL でなく WARN = organon は任意サブシステム)。
  test('ORGANON_INJECT=true + organon 不在 → warn (silent degrade を可視化)', () => {
    process.env.ORGANON_INJECT = 'true';
    logOrganonInjectState({ organonPath: '/nonexistent/organon' });
    expect(warnMsg()).toContain('organon inject');
    expect(warnMsg()).toContain('/nonexistent/organon');
  });

  // #347 ①: ORGANON_INJECT=true で organon はあるが sql_mapping entries 0 件 =
  // inject が実質空。これも warn で「ON なのに効いていない」を可視化。
  test('ORGANON_INJECT=true + entries 0 件 → warn (実質空注入を可視化)', () => {
    process.env.ORGANON_INJECT = 'true';
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\ncontext: x\n', // sql_mapping なし
    });
    try {
      logOrganonInjectState({ organonPath: tmpDir });
      expect(warnMsg()).toContain('organon inject');
      expect(warnMsg()).toContain('entries=0');
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});
