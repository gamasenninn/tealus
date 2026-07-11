/**
 * #327 loader のテーブルオーバーレイ挙動。
 *   - テーブルが空 / DB 不達 → file の vocabulary にフォールバック (非破壊)
 *   - テーブルに active 行あり → vocabulary をテーブルで置換 (実行時 source of truth)
 *   - whisper_context / guidelines は常に file 継続
 */
const config = require('../../src/services/transcriptionConfig');
const repo = require('../../src/services/dictionaryRepo');
const { setupTestDb, closeTestDb, getTestPool } = require('../helpers/db');

// file 側 (config/transcription_guideline.json) にしか無い前提の既知 term / テーブル専用の識別 term
const FILE_ONLY_TERM = 'ガマ';
const TABLE_ONLY_A = 'ズンドコ検証用A';
const TABLE_ONLY_B = 'ズンドコ検証用B';

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => {
  await closeTestDb();
  await require('../../src/db/pool').pool.end();
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
  expect(g.vocabulary).toHaveLength(2); // file(214) でなくテーブル(2) = 置換であって merge でない
  const byTerm = Object.fromEntries(g.vocabulary.map((v) => [v.term, v]));
  expect(byTerm[TABLE_ONLY_A].aliases).toEqual(['ずんA']);
  expect(byTerm[TABLE_ONLY_A].reading).toBe('てすとえー'); // superset フィールド温存
  expect(byTerm[FILE_ONLY_TERM]).toBeUndefined(); // file 由来は出ない
});

test('rejected term / alias はオーバーレイに出ない', async () => {
  const a = await repo.upsertTerm({ term: TABLE_ONLY_A });
  const rej = await repo.upsertAlias({ termId: a.id, alias: '却下別名', source: 'auto', count: 1 });
  await repo.setAliasStatus(rej.row.id, 'rejected');
  await repo.upsertAlias({ termId: a.id, alias: '生き別名', source: 'auto', count: 1 });
  await config.refreshVocabFromTable();

  const v = config.loadGuideline().vocabulary.find((x) => x.term === TABLE_ONLY_A);
  expect(v.aliases).toEqual(['生き別名']);
});

test('whisper_context / guidelines はオーバーレイ時も file 継続', async () => {
  const a = await repo.upsertTerm({ term: TABLE_ONLY_A });
  await config.refreshVocabFromTable();
  const g = config.loadGuideline();
  expect(g.vocabulary).toHaveLength(1);           // overlay 効いている
  expect(typeof g.whisper_context).toBe('string'); // でも context は file から
  expect(g.whisper_context.length).toBeGreaterThan(0);
});
