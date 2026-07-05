/**
 * #327 自己成長ループ learnFromEdit の DB テスト。
 * 出現数(corpus-precision の分母)は opts.getOccurrence で差し替え、判定を決定的にする。
 */
const learner = require('../../src/services/dictionaryLearner');
const repo = require('../../src/services/dictionaryRepo');
const config = require('../../src/services/transcriptionConfig');
const { setupTestDb, closeTestDb, getTestPool } = require('../helpers/db');

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => {
  await closeTestDb();
  await require('../../src/db/pool').end();
});
beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
  await config.refreshVocabFromTable();
});

// term に読みを与えて音韻ゲートを通す（seed 済 organon term は reading NULL 前提の別軸）
async function seedTerm(term, reading, category = 'person') {
  return repo.upsertTerm({ term, reading, category, source: 'organon' });
}

async function alias(termId, a) {
  const { rows } = await getTestPool().query(
    'SELECT * FROM dictionary_aliases WHERE term_id=$1 AND alias=$2', [termId, a]);
  return rows[0];
}

test('崩れ→既知term を学習し pending で累積（corpus-precision 未達なら未昇格）', async () => {
  await seedTerm('保坂', 'ほさか');
  // ホタカ 初回: occ=9, count=1 → P=0.11 < 0.5 → pending
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 9 });
  expect(r.learned).toBe(1);
  expect(r.pending).toBe(1);
  expect(r.promoted).toBe(0);
  const t = await repo.getTermByName('保坂');
  const a = await alias(t.id, 'ホタカ');
  expect(a.status).toBe('pending');
  expect(a.count).toBe(1);
  // pending は補正段オーバーレイに出ない
  const v = config.loadGuideline().vocabulary.find((x) => x.term === '保坂');
  expect(v.aliases).not.toContain('ホタカ');
});

test('累積で corpus-precision を満たすと active に昇格しオーバーレイに出る', async () => {
  const t = await seedTerm('保坂', 'ほさか');
  // 手動で count を積んだ状態にして、次の編集で P>=0.5 になる境界を作る
  // occ=6 固定。count が 3 になれば P=0.5 → active
  await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 2, status: 'pending' });
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 6 }); // count 2+1=3, P=3/6=0.5
  expect(r.promoted).toBe(1);
  const a = await alias(t.id, 'ホタカ');
  expect(a.status).toBe('active');
  expect(a.count).toBe(3);
  const v = config.loadGuideline().vocabulary.find((x) => x.term === '保坂');
  expect(v.aliases).toContain('ホタカ');
});

test('音韻が遠い誤整列は学習しない（どうも→ガマ）', async () => {
  await seedTerm('ガマ', 'がま');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'どうも戻りました', newFormatted: 'ガマ戻りました' },
    { getOccurrence: async () => 3 });
  // 「どうも」削除・「ガマ」挿入だが音韻遠 → 学習ゼロ
  expect(r.learned).toBe(0);
});

test('tombstone(rejected) は学習で復活しない', async () => {
  const t = await seedTerm('保坂', 'ほさか');
  const { row } = await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 1, status: 'pending' });
  await repo.setAliasStatus(row.id, 'rejected');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 2 });
  expect(r.learned).toBe(0);
  const a = await alias(t.id, 'ホタカ');
  expect(a.status).toBe('rejected');
  expect(a.count).toBe(1); // 加算されない
});

test('AI版と人間版が同一なら何もしない', async () => {
  await seedTerm('保坂', 'ほさか');
  const r = await learner.learnFromEdit({ priorFormatted: '同じ文', newFormatted: '同じ文' });
  expect(r.learned).toBe(0);
});
