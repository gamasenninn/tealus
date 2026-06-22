/**
 * vocabContext unit test — STT vocab を agent prompt に inject (opt-in)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/lib/logger', () => ({
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
}));
const logger = require('../../src/lib/logger');
const { loadVocabForPrompt, logVocabInjectState } = require('../../src/lib/vocabContext');

function writeFixture(vocab) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-ctx-test-'));
  const file = path.join(dir, 'transcription_guideline.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, vocabulary: vocab }));
  return { dir, file };
}

let tmp;
const origInject = process.env.VOCAB_INJECT;
afterEach(() => {
  if (origInject === undefined) delete process.env.VOCAB_INJECT;
  else process.env.VOCAB_INJECT = origInject;
  if (tmp) { try { fs.rmSync(tmp.dir, { recursive: true, force: true }); } catch {} tmp = null; }
  logger.info.mockClear();
});

describe('loadVocabForPrompt (opt-in)', () => {
  test('VOCAB_INJECT 未設定 (default) は 空文字', () => {
    delete process.env.VOCAB_INJECT;
    tmp = writeFixture([{ term: '高山', category: 'person', aliases: ['田山'] }]);
    expect(loadVocabForPrompt({ filePath: tmp.file })).toBe('');
  });

  test('VOCAB_INJECT=true で 別名→正規名 ブロックを返す', () => {
    process.env.VOCAB_INJECT = 'true';
    tmp = writeFixture([
      { term: '高山', category: 'person', aliases: ['高山さん', '田山'] },
      { term: '五月女', category: 'person', aliases: ['ソートメ', 'ソウトメ'] },
    ]);
    const out = loadVocabForPrompt({ filePath: tmp.file });
    expect(out).toContain('## 業務語彙の正規化');
    expect(out).toContain('高山 ← 高山さん, 田山');
    expect(out).toContain('五月女 ← ソートメ, ソウトメ');
  });

  test('aliases 無し entry は除外', () => {
    process.env.VOCAB_INJECT = 'true';
    tmp = writeFixture([{ term: 'X', aliases: [] }, { term: 'Y', aliases: ['y1'] }]);
    const out = loadVocabForPrompt({ filePath: tmp.file });
    expect(out).not.toContain('X ←');
    expect(out).toContain('Y ← y1');
  });

  test('ファイル不在は 空文字 (degrade)', () => {
    process.env.VOCAB_INJECT = 'true';
    expect(loadVocabForPrompt({ filePath: '/nonexistent/x.json' })).toBe('');
  });

  test('vocabulary 0 件は 空文字', () => {
    process.env.VOCAB_INJECT = 'true';
    tmp = writeFixture([]);
    expect(loadVocabForPrompt({ filePath: tmp.file })).toBe('');
  });
});

describe('logVocabInjectState', () => {
  test('ON で terms 数を含むログ', () => {
    process.env.VOCAB_INJECT = 'true';
    tmp = writeFixture([{ term: 'A', aliases: ['a'] }, { term: 'B', aliases: [] }]);
    logVocabInjectState({ filePath: tmp.file });
    const msg = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(msg).toContain('vocab inject: ON');
    expect(msg).toContain('terms=1');
  });

  test('未設定で OFF ログ', () => {
    delete process.env.VOCAB_INJECT;
    logVocabInjectState();
    expect(logger.info.mock.calls.map((c) => c[0]).join('\n')).toContain('vocab inject: OFF');
  });
});
