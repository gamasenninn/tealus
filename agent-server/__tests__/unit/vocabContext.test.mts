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
      { term: '乙野', category: 'person', aliases: ['オツノ', 'オツノウ'] },
    ]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).toContain('## 業務語彙の正規化');
    expect(out).toContain('高山 ← 高山さん, 田山');
    expect(out).toContain('乙野 ← オツノ, オツノウ');
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

/**
 * #377: 表は渡っているのに議事録で使われなかった件。原因は「使え」という指示の側で、
 * 文面が OCR 前提 (「画像・帳票から読み取った語」) だったため 音声起こし由来の人名に
 * 向いていなかった。指示は表と同じ block に載せる = Light / Deep 全経路に同時に届く。
 */
describe('#377 指示文: 音声起こし / 議事録も対象と明示する (OCR 前提を外す)', () => {
  const ttl = () => writeTtl([{ term: '乙野', category: 'person', aliases: ['オツノ', '音野'] }]);

  test('音声の文字起こし・議事録が対象だと明示している', () => {
    process.env.VOCAB_INJECT = 'true';
    const out = loadVocabForPrompt({ ttlPath: ttl() });
    expect(out).toContain('音声');
    expect(out).toContain('議事録');
  });

  test('別名に一致したら正規名に「置換」する (認識補助で終わらせない)', () => {
    process.env.VOCAB_INJECT = 'true';
    const out = loadVocabForPrompt({ ttlPath: ttl() });
    expect(out).toContain('置換');
    // Deep 側 (dispatcher buildDeepPrompt) の方針 1 と同じく、元表記の併記は不要と明示する
    expect(out).toMatch(/元(の)?表記.*(残す必要|不要)/);
  });

  test('OCR 専用と読める列挙 (画像・帳票のみ) にはなっていない', () => {
    process.env.VOCAB_INJECT = 'true';
    const out = loadVocabForPrompt({ ttlPath: ttl() });
    const heading = out.split('\n').find((l) => l.includes('別名')) || '';
    expect(heading).not.toMatch(/^画像・帳票・文章から読み取った語/);
  });
});

describe('fallback: ttl 不在なら legacy JSON (最後の砦、旧挙動保持)', () => {
  test('ttl 不在 + json あり → json から読む', () => {
    process.env.VOCAB_INJECT = 'true';
    const json = writeJson([{ term: '丙野', category: 'person', aliases: ['平野'] }]);
    const out = loadVocabForPrompt({ ttlPath: MISSING_TTL, filePath: json });
    expect(out).toContain('丙野 ← 平野');
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

/**
 * #403 過補正ガード —— 呼称・愛称を「置換せよ」と指示しない
 *
 * 実測 (2026-09-04、message_edits 502 便の全走査): AI が書いた朝礼議事録で、
 * 正規名が人に呼称へ戻された編集が 6 月から 4 件あった。
 *   役職語 → 人物のフルネーム 3 件 (07-11 / 07-23 / 09-04)、1 文字の愛称 → 同 1 件 (06-15)
 * 「社長」と言ったら社長であって、人物のフルネームに変えたら誤り (= 崩れの修正ではない)。
 *
 * 原因は文面の差だった。server 側の organon 補正段 (buildOrganonCorrectionPrompt) は
 * 別名を「転写ブレ例」として渡し、「単独の一般的な姓を文脈が支持しない限りフルネームへ
 * 展開しない」ガードを持つ (Day48 Exp7)。agent-server の inject には そのガードが無く、
 * 「別名と一致する語が現れたら正規名に置換してください」と無条件に命じていた。
 * 同じ辞書で挙動が割れていた理由がこれ (文字起こし側は 434 便で過補正 0 件)。
 *
 * 除外は 2 種類。既知 4 件をすべて覆い、本番 721 alias のうち 14 本 (2%) だけに当たる:
 *   - 汎用役職語 (server/glossaryRanker.mts の DEFAULT_ROLE_ALIASES、2026-07-03 #326)
 *   - 1 文字 alias (姓の 1 字・愛称。identity 引きには要るが、置換指示にすると危険)
 */
describe('過補正ガード (#403)', () => {
  beforeEach(() => { process.env.VOCAB_INJECT = 'true'; });

  /** 一覧の行 (`- term ← alias, …`) だけを取り出す。ガード文は「社長」を例に挙げるので除く */
  const listLines = (out: string) => out.split('\n').filter((l) => l.startsWith('- ')).join('\n');

  test('汎用役職語の alias は 置換リストに出さない', () => {
    const ttl = writeTtl([{ term: '架空太郎', category: 'person', aliases: ['社長', '専務', '架空専務'] }]);
    const list = listLines(loadVocabForPrompt({ ttlPath: ttl }));
    expect(list).toBe('- 架空太郎 ← 架空専務');   // 名前付き役職だけが残る
  });

  test('1 文字 alias は 置換リストに出さない (2026-06-15 の 1 件がこの形)', () => {
    const ttl = writeTtl([{ term: '架空花子', category: 'person', aliases: ['花', '子', 'ハナさん', '架空花子さん'] }]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(listLines(out)).toBe('- 架空花子 ← ハナさん, 架空花子さん');
  });

  test('崩れの alias は これまでどおり残る', () => {
    const ttl = writeTtl([{ term: '架空次郎', category: 'person', aliases: ['大阪', 'カクウ', '細川'] }]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).toContain('大阪');
    expect(out).toContain('カクウ');
    expect(out).toContain('細川');
  });

  test('alias が すべて除外対象なら その行ごと出さない', () => {
    const ttl = writeTtl([
      { term: '架空三郎', category: 'person', aliases: ['会長'] },
      { term: '架空四郎', category: 'person', aliases: ['カクウ四郎'] },
    ]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).not.toContain('架空三郎');
    expect(out).toContain('架空四郎');
  });

  test('過補正ガードの一文が prompt に入る (server 側と同趣旨)', () => {
    const ttl = writeTtl([{ term: '架空五郎', category: 'person', aliases: ['カクウ五郎'] }]);
    const out = loadVocabForPrompt({ ttlPath: ttl });
    expect(out).toContain('フルネーム');
    expect(out).toMatch(/呼び方|呼称|役職/);
  });
});
