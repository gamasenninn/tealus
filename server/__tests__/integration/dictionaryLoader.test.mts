/**
 * #327 loader のテーブルオーバーレイ挙動。
 *   - テーブルが空 / DB 不達 → file の vocabulary にフォールバック (非破壊)
 *   - テーブルに active 行あり → vocabulary をテーブルで置換 (実行時 source of truth)
 *   - whisper_context / guidelines は常に file 継続
 *
 * 本番 guideline file (config/transcription_guideline.json は .gitignore、machine 固有) には
 * 依存しない: TRANSCRIPTION_GUIDELINE_PATH env override で test 専用 fixture を指す
 * (= transcriptionConfig.test と同じ feedback_test_file_guard パターン、CI でも決定論)。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';

// file 側 fixture にのみ有る term / テーブル専用の識別 term
const FILE_ONLY_TERM = 'ガマ';
const TABLE_ONLY_A = 'ズンドコ検証用A';
const TABLE_ONLY_B = 'ズンドコ検証用B';

// file fallback を検証するための test fixture (本番 file の代わり)
const GUIDELINE_FIXTURE = {
  version: 1,
  whisper_context: 'これは業務無線の文字起こしです。固有名詞に注意: ガマ、丙野。',
  vocabulary: [
    { term: FILE_ONLY_TERM, category: 'person', reading: 'がま' },
    { term: '丙野', category: 'person' },
  ],
  guidelines: ['句読点を適切に付与する'],
};

// env override は config module load 前に効かせる必要があるため、resetModules + require で
// fresh に読み込む (config/repo/pool を同一 registry から取得し pool 二重化を回避)。
let config: typeof import('../../src/services/transcriptionConfig.mts');
let repo: typeof import('../../src/services/dictionaryRepo.mts');
let pool: typeof import('../../src/db/pool.mts').pool;
let tmpFile: string;
let tmpTtl: string; // #348 (a): refresh が書き出す local.ttl を test 専用 path に逃がす

beforeAll(async () => {
  await setupTestDb();
  tmpFile = path.join(os.tmpdir(), `tealus-dictloader-guideline-${process.pid}-${Date.now()}.json`);
  tmpTtl = path.join(os.tmpdir(), `tealus-dictloader-local-${process.pid}-${Date.now()}.ttl`);
  fs.writeFileSync(tmpFile, JSON.stringify(GUIDELINE_FIXTURE));
  process.env.TRANSCRIPTION_GUIDELINE_PATH = tmpFile;
  process.env.LOCAL_TTL_PATH = tmpTtl; // 本番 config/dictionary.local.ttl を汚さない
  jest.resetModules();
  config = require('../../src/services/transcriptionConfig');
  repo = require('../../src/services/dictionaryRepo');
  ({ pool } = require('../../src/db/pool'));
});
afterAll(async () => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  if (fs.existsSync(tmpTtl)) fs.unlinkSync(tmpTtl);
  delete process.env.TRANSCRIPTION_GUIDELINE_PATH;
  delete process.env.LOCAL_TTL_PATH;
  await closeTestDb();
  await pool.end();
});
beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
  await config.refreshVocabFromTable(); // 空 → overlay を null に戻す
});

test('空テーブル → file の vocabulary にフォールバックする', () => {
  const g = config.loadGuideline();
  expect(g.vocabulary.length).toBeGreaterThan(0);
  expect(g.vocabulary.some((v) => v.term === FILE_ONLY_TERM)).toBe(true); // file 由来
  expect(g.vocabulary.some((v) => v.term === TABLE_ONLY_A)).toBe(false);
});

test('active 行あり → vocabulary をテーブルで置換する (file を上書き)', async () => {
  const a = await repo.upsertTerm({ term: TABLE_ONLY_A, category: 'person', reading: 'てすとえー' });
  await repo.upsertAlias({ termId: a.id, alias: 'ずんA', source: 'auto', count: 3 });
  await repo.upsertTerm({ term: TABLE_ONLY_B, category: 'product' });
  const n = await config.refreshVocabFromTable();

  expect(n).toBe(2);
  const g = config.loadGuideline();
  expect(g.vocabulary).toHaveLength(2); // file(fixture 2) でなくテーブル(2) = 置換であって merge でない
  const byTerm = Object.fromEntries(g.vocabulary.map((v) => [v.term, v]));
  expect(byTerm[TABLE_ONLY_A].aliases).toEqual(['ずんA']);
  expect(byTerm[TABLE_ONLY_A].reading).toBe('てすとえー'); // superset フィールド温存
  expect(byTerm[FILE_ONLY_TERM]).toBeUndefined(); // file 由来は出ない
});

test('rejected term / alias はオーバーレイに出ない', async () => {
  const a = await repo.upsertTerm({ term: TABLE_ONLY_A });
  const rej = await repo.upsertAlias({ termId: a.id, alias: '却下別名', source: 'auto', count: 1 });
  await repo.setAliasStatus(rej.row!.id, 'rejected');
  await repo.upsertAlias({ termId: a.id, alias: '生き別名', source: 'auto', count: 1 });
  await config.refreshVocabFromTable();

  const v = config.loadGuideline().vocabulary.find((x) => x.term === TABLE_ONLY_A);
  expect(v!.aliases).toEqual(['生き別名']);
});

test('#348 (a): active 行ありで refresh すると local.ttl が 5 field で書き出される', async () => {
  const a = await repo.upsertTerm({ term: TABLE_ONLY_A, category: 'person', reading: 'てすとえー', description: 'テスト整備長' });
  await repo.upsertAlias({ termId: a.id, alias: 'ずんA', source: 'auto', count: 3 });
  await config.refreshVocabFromTable();

  expect(fs.existsSync(tmpTtl)).toBe(true);
  const ttl = fs.readFileSync(tmpTtl, 'utf8');
  // 5 field 全部が載る (term/reading/category/description/alias)
  expect(ttl).toContain('rdfs:label "ズンドコ検証用A"');
  expect(ttl).toContain('org1:reading "てすとえー"');
  expect(ttl).toContain('org1:category "person"');
  expect(ttl).toContain('org1:description "テスト整備長"');
  expect(ttl).toContain('org1:alias "ずんA"');
});

test('whisper_context / guidelines はオーバーレイ時も file 継続', async () => {
  await repo.upsertTerm({ term: TABLE_ONLY_A });
  await config.refreshVocabFromTable();
  const g = config.loadGuideline();
  expect(g.vocabulary).toHaveLength(1);           // overlay 効いている
  expect(typeof g.whisper_context).toBe('string'); // でも context は file から
  expect(g.whisper_context.length).toBeGreaterThan(0);
});
