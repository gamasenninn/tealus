/**
 * vocabContext unit test — STT vocab を agent prompt に inject (opt-in)
 *
 * #348 (b): 供給源を legacy JSON → 本体発行の local.ttl に切替。
 *   - primary: local.ttl (org1: RDF、server の refreshVocabFromTable が発行)
 *   - fallback: legacy transcription_guideline.json (最後の砦、旧挙動保持)
 *   - 出力 (term ← alias ブロック) は不変 = 振る舞い等価。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.mock('../../src/lib/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn(),
} }));
import { logger } from '../../src/lib/logger.mts';
import { loadVocabForPrompt, logVocabInjectState, loadVocabEntriesFromTtl } from '../../src/lib/vocabContext.mts';

interface FixtureEntry { term: string; category?: string; reading?: string; description?: string; aliases?: string[] }

/** server の serializeVocabToTtl と同形の Turtle を組む (test fixture) */
function ttlDoc(entries: FixtureEntry[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = [
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix org1: <https://tealus.local/organon/> .',
    '',
  ];
  for (const e of entries) {
    const preds = [`rdfs:label "${esc(e.term)}"`];
    if (e.category) preds.push(`org1:category "${esc(e.category)}"`);
    if (e.reading) preds.push(`org1:reading "${esc(e.reading)}"`);
    if (e.aliases && e.aliases.length) preds.push(`org1:alias ${e.aliases.map((a) => `"${esc(a)}"`).join(', ')}`);
    if (e.description) preds.push(`org1:description "${esc(e.description)}"`);
    lines.push(`<https://tealus.local/dict/${encodeURIComponent(e.term)}>\n  ${preds.join(' ;\n  ')} .`);
    lines.push('');
  }
  return lines.join('\n');
}

let dir: string | null;
function writeTtl(entries: FixtureEntry[]): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-ctx-test-'));
  const file = path.join(dir, 'dictionary.local.ttl');
  fs.writeFileSync(file, ttlDoc(entries));
  return file;
}
function writeJson(vocab: unknown[]): string {
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-ctx-test-'));
  const file = path.join(dir, 'transcription_guideline.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, vocabulary: vocab }));
  return file;
}
const MISSING_TTL = path.join(os.tmpdir(), 'vocab-ctx-nonexistent.ttl');

const origInject = process.env.VOCAB_INJECT;
afterEach(() => {
  if (origInject === undefined) delete process.env.VOCAB_INJECT;
  else process.env.VOCAB_INJECT = origInject;
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} dir = null; }
  (logger.info as jest.Mock).mockClear();
});

describe('loadVocabEntriesFromTtl (#348 (b) parser)', () => {
  test('5 field を parse する (term/aliases/reading/category/description)', () => {
    const file = writeTtl([
      { term: '高山', category: 'person', reading: 'たかやま', description: '整備', aliases: ['高山さん', '田山'] },
    ]);
    const entries = loadVocabEntriesFromTtl(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].term).toBe('高山');
    expect(entries[0].category).toBe('person');
    expect(entries[0].reading).toBe('たかやま');
    expect(entries[0].description).toBe('整備');
    expect(entries[0].aliases.sort()).toEqual(['高山さん', '田山'].sort());
  });

  test('file 不在は 空配列', () => {
    expect(loadVocabEntriesFromTtl(MISSING_TTL)).toEqual([]);
  });

  test('壊れた ttl は 空配列 (throw しない)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-ctx-test-'));
    const file = path.join(dir, 'broken.ttl');
    fs.writeFileSync(file, '<<< not turtle @@@');
    expect(loadVocabEntriesFromTtl(file)).toEqual([]);
  });
});

describe('loadVocabForPrompt (primary = local.ttl)', () => {
  test('VOCAB_INJECT 未設定 (default) は 空文字', () => {
    delete process.env.VOCAB_INJECT;
    const ttl = writeTtl([{ term: '高山', category: 'person', aliases: ['田山'] }]);
    expect(loadVocabForPrompt({ ttlPath: ttl })).toBe('');
  });

  test('VOCAB_INJECT=true で local.ttl から 別名→正規名 ブロックを返す (出力形式 不変)', () => {
    process.env.VOCAB_INJECT = 'true';
    const ttl = writeTtl([
      { term: '高山', category: 'person', aliases: ['高山さん', '田山'] },
      { term: '五月女', category: 'person', aliases: ['ソートメ', 'ソウトメ'] },
    ]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).toContain('## 業務語彙の正規化');
    expect(out).toContain('高山 ← 高山さん, 田山');
    expect(out).toContain('五月女 ← ソートメ, ソウトメ');
  });

  test('aliases 無し entry は除外', () => {
    process.env.VOCAB_INJECT = 'true';
    const ttl = writeTtl([{ term: 'X', aliases: [] }, { term: 'Y', aliases: ['y1'] }]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).not.toContain('X ←');
    expect(out).toContain('Y ← y1');
  });

  test('ttl 0 件 かつ json fallback も無し → 空文字', () => {
    process.env.VOCAB_INJECT = 'true';
    const ttl = writeTtl([]);
    // ttl が空なら fallback を試すので、json も不在にして「どこにも無い」を検証する
    expect(loadVocabForPrompt({ ttlPath: ttl, filePath: '/nonexistent/x.json' })).toBe('');
  });
});

describe('fallback: ttl 不在なら legacy JSON (最後の砦、旧挙動保持)', () => {
  test('ttl 不在 + json あり → json から読む', () => {
    process.env.VOCAB_INJECT = 'true';
    const json = writeJson([{ term: '藤井', category: 'person', aliases: ['富士井'] }]);
    const out = loadVocabForPrompt({ ttlPath: MISSING_TTL, filePath: json });
    expect(out).toContain('藤井 ← 富士井');
  });

  test('ttl も json も無い → 空文字', () => {
    process.env.VOCAB_INJECT = 'true';
    expect(loadVocabForPrompt({ ttlPath: MISSING_TTL, filePath: '/nonexistent/x.json' })).toBe('');
  });

  test('ttl と json 両方あれば ttl 優先', () => {
    process.env.VOCAB_INJECT = 'true';
    const ttl = writeTtl([{ term: 'TTL語', aliases: ['ttl別名'] }]);
    const json = writeJson([{ term: 'JSON語', aliases: ['json別名'] }]);
    const out = loadVocabForPrompt({ ttlPath: ttl, filePath: json });
    expect(out).toContain('TTL語 ← ttl別名');
    expect(out).not.toContain('JSON語');
  });
});

describe('logVocabInjectState', () => {
  test('ON で terms 数を含むログ (ttl 由来)', () => {
    process.env.VOCAB_INJECT = 'true';
    const ttl = writeTtl([{ term: 'A', aliases: ['a'] }, { term: 'B', aliases: [] }]);
    logVocabInjectState({ ttlPath: ttl });
    const msg = (logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(msg).toContain('vocab inject: ON');
    expect(msg).toContain('terms=1');
  });

  test('未設定で OFF ログ', () => {
    delete process.env.VOCAB_INJECT;
    logVocabInjectState();
    expect((logger.info as jest.Mock).mock.calls.map((c: unknown[]) => c[0]).join('\n')).toContain('vocab inject: OFF');
  });
});
