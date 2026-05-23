/**
 * OrganonReloader ユニットテスト
 *
 * 関連: Issue #283 (= SQL bridge thesis、5/21 (d) 起票) Phase A skeleton
 * organon Day 6 (i) (= 5/22 PoC evidence 5 dimension 達成) dep 解除後の本体班 implementation 着手第 1 step
 *
 * scope: load + format の core path のみ、3 cycle (= cron / ad-hoc / weekly) は Phase B
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { OrganonReloader } = require('../../src/lib/organonReloader');

/**
 * tmp organon repo を test fixture として作成
 * structure: <tmpDir>/entries/polyseme/*.yaml
 */
function setupFixture(entries) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-test-'));
  const polysemeDir = path.join(tmpDir, 'entries', 'polyseme');
  fs.mkdirSync(polysemeDir, { recursive: true });
  for (const [filename, content] of Object.entries(entries)) {
    fs.writeFileSync(path.join(polysemeDir, filename), content);
  }
  return tmpDir;
}

function cleanupFixture(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('OrganonReloader.isAvailable', () => {
  test('repo path + entries dir 存在で true', () => {
    const tmpDir = setupFixture({ 'foo.yaml': 'term: foo\n' });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      expect(reloader.isAvailable()).toBe(true);
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('repo path 不在で false', () => {
    const reloader = new OrganonReloader({ repoPath: '/nonexistent/path' });
    expect(reloader.isAvailable()).toBe(false);
  });

  test('entries dir 不在で false', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-test-'));
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      expect(reloader.isAvailable()).toBe(false);
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('OrganonReloader.loadPolysemeEntries', () => {
  test('polyseme yaml files を全件 load', () => {
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nkind: polyseme\nsql_mapping:\n  type: simple\n  db_column: 店長確認\n  db_value: OK\n',
      '売上.yaml': 'term: 売上\nkind: polyseme\nsql_mapping:\n  type: fuzzy_match\n',
    });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const entries = reloader.loadPolysemeEntries();
      expect(entries).toHaveLength(2);
      const terms = entries.map(e => e.term).sort();
      expect(terms).toEqual(['売上', '納品']);
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('polyseme dir 不在で 空配列 + warn (= 5+1 #5 stub 運用)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-test-'));
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const entries = reloader.loadPolysemeEntries();
      expect(entries).toEqual([]);
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('.yaml 以外の file は無視', () => {
    const tmpDir = setupFixture({
      'foo.yaml': 'term: foo\n',
      'README.md': '# readme',
      'bar.txt': 'text',
    });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const entries = reloader.loadPolysemeEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].term).toBe('foo');
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('OrganonReloader.formatForPrompt', () => {
  test('entries 0 件で空文字', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-test-'));
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      expect(reloader.formatForPrompt()).toBe('');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('entries あり時、yaml code block 形式で整形', () => {
    const tmpDir = setupFixture({
      '納品.yaml': 'term: 納品\nkind: polyseme\nsql_mapping:\n  type: simple\n',
    });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const formatted = reloader.formatForPrompt();
      expect(formatted).toContain('## 業務語彙');
      expect(formatted).toContain('### 納品');
      expect(formatted).toContain('```yaml');
      expect(formatted).toContain('term: 納品');
      expect(formatted).toContain('kind: polyseme');
    } finally {
      cleanupFixture(tmpDir);
    }
  });

  test('引数で明示的 entries 渡せる (= Phase B 自動 cycle 用 hook)', () => {
    const tmpDir = setupFixture({ 'foo.yaml': 'term: foo\n' });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const custom = [{ term: 'custom', content: 'term: custom\n' }];
      const formatted = reloader.formatForPrompt(custom);
      expect(formatted).toContain('### custom');
      expect(formatted).not.toContain('### foo'); // custom が優先
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});

describe('OrganonReloader.invalidate', () => {
  test('cache invalidate で次回 load が re-read', () => {
    const tmpDir = setupFixture({ 'a.yaml': 'term: a\n' });
    try {
      const reloader = new OrganonReloader({ repoPath: tmpDir });
      const first = reloader.loadPolysemeEntries();
      expect(first).toHaveLength(1);

      // 追加 file
      fs.writeFileSync(path.join(tmpDir, 'entries', 'polyseme', 'b.yaml'), 'term: b\n');

      // cache 効いてる間は変化なし (formatForPrompt の引数なし呼出)
      expect(reloader.formatForPrompt()).toContain('### a');
      expect(reloader.formatForPrompt()).not.toContain('### b');

      // invalidate 後は再 load
      reloader.invalidate();
      const second = reloader.loadPolysemeEntries();
      expect(second).toHaveLength(2);
    } finally {
      cleanupFixture(tmpDir);
    }
  });
});
