/**
 * #327 自己成長ループ learnFromEdit の DB テスト。
 * 出現数(corpus-precision の分母)は opts.getOccurrence、garble 読みは opts.getReadings で差し替え
 * (pykakasi subprocess を回避し判定を決定的にする)。
 */
import * as learner from '../../src/services/dictionaryLearner.mts';
import * as repo from '../../src/services/dictionaryRepo.mts';
import * as config from '../../src/services/transcriptionConfig.mts';
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { pool } from '../../src/db/pool.mts';

// katakana garble は空マップ→kata2hira にフォールバック(pykakasi を呼ばない)
const NO_PYKAKASI = async (): Promise<Map<string, string>> => new Map();

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => {
  await closeTestDb();
  await pool.end();
});
beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
  await config.refreshVocabFromTable();
});

async function seedTerm(term: string, reading?: string, category = 'person') {
  return repo.upsertTerm({ term, reading, category, source: 'organon' });
}
async function alias(termId: string, a: string) {
  const { rows } = await getTestPool().query(
    'SELECT * FROM dictionary_aliases WHERE term_id=$1 AND alias=$2', [termId, a]);
  return rows[0];
}

test('崩れ→既知term を学習し pending で累積（corpus-precision 未達なら未昇格）', async () => {
  await seedTerm('保坂', 'ほさか');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 9, getReadings: NO_PYKAKASI });
  expect(r.learned).toBe(1);
  expect(r.pending).toBe(1);
  expect(r.promoted).toBe(0);
  const t = await repo.getTermByName('保坂');
  const a = await alias(t!.id, 'ホタカ');
  expect(a.status).toBe('pending');
  expect(a.count).toBe(1);
  const v = config.loadGuideline().vocabulary.find((x) => x.term === '保坂');
  expect(v!.aliases).not.toContain('ホタカ');
});

test('累積で corpus-precision を満たすと active に昇格しオーバーレイに出る', async () => {
  const t = await seedTerm('保坂', 'ほさか');
  await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 2, status: 'pending' });
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 6, getReadings: NO_PYKAKASI }); // count 2+1=3, P=3/6=0.5
  expect(r.promoted).toBe(1);
  const a = await alias(t.id, 'ホタカ');
  expect(a.status).toBe('active');
  expect(a.count).toBe(3);
  const v = config.loadGuideline().vocabulary.find((x) => x.term === '保坂');
  expect(v!.aliases).toContain('ホタカ');
});

test('音韻が遠い誤整列は学習しない（どうも→ガマ）', async () => {
  await seedTerm('ガマ', 'がま');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'どうも戻りました', newFormatted: 'ガマ戻りました' },
    { getOccurrence: async () => 3, getReadings: NO_PYKAKASI });
  expect(r.learned).toBe(0);
});

test('tombstone(rejected) は学習で復活しない', async () => {
  const t = await seedTerm('保坂', 'ほさか');
  const { row } = await repo.upsertAlias({ termId: t.id, alias: 'ホタカ', source: 'auto', count: 1, status: 'pending' });
  await repo.setAliasStatus(row!.id, 'rejected');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'ホタカさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 2, getReadings: NO_PYKAKASI });
  expect(r.learned).toBe(0);
  const a = await alias(t.id, 'ホタカ');
  expect(a.status).toBe('rejected');
  expect(a.count).toBe(1);
});

test('AI版と人間版が同一なら何もしない', async () => {
  await seedTerm('保坂', 'ほさか');
  const r = await learner.learnFromEdit({ priorFormatted: '同じ文', newFormatted: '同じ文' });
  expect(r.learned).toBe(0);
});

test('★漢字 garble も pykakasi 読みが供給されれば学習する（田名島→田島）', async () => {
  await seedTerm('田島', 'たじま');
  const r = await learner.learnFromEdit(
    { priorFormatted: '田名島さん取れますか', newFormatted: '田島さん取れますか' },
    { getOccurrence: async () => 3, getReadings: async () => new Map([['田名島', 'たなじま']]) });
  // たなじま ≈ たじま (d=0.25) → 音韻通過、count1/occ3 P=0.33 → pending
  expect(r.learned).toBe(1);
  expect(r.pending).toBe(1);
  const t = await repo.getTermByName('田島');
  expect((await alias(t!.id, '田名島')).status).toBe('pending');
});

test('★漢字 garble に読みが無いと音韻ゲートで棄却される（供給欠落＝旧挙動の証拠）', async () => {
  await seedTerm('田島', 'たじま');
  const r = await learner.learnFromEdit(
    { priorFormatted: '田名島さん取れますか', newFormatted: '田島さん取れますか' },
    { getOccurrence: async () => 3, getReadings: NO_PYKAKASI }); // 読み供給なし→kata2hira→漢字のまま→d=1.0
  expect(r.learned).toBe(0);
  expect(r.extracted).toBe(1);       // 抽出はできている
  expect(r.gateRejected).toBe(1);    // が音韻ゲートで落ちる
});

test('★2字の漢字姓も読みが3モーラなら学習する（小坂→保坂、②モーラ数ゲート）', async () => {
  await seedTerm('保坂', 'ほさか');
  const r = await learner.learnFromEdit(
    { priorFormatted: '小坂さん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 5, getReadings: async () => new Map([['小坂', 'こさか']]) });
  // こさか(3モーラ) → モーラ数ゲート通過、こさか≈ほさか(d=0.33) → 音韻通過、count1/occ5 P=0.2 → pending
  expect(r.learned).toBe(1);
  expect(r.pending).toBe(1);
  const t = await repo.getTermByName('保坂');
  expect((await alias(t!.id, '小坂')).status).toBe('pending');
});

test('★読みが2モーラの短い garble はモーラ数ゲートで棄却（コサ→保坂）', async () => {
  await seedTerm('保坂', 'ほさか');
  const r = await learner.learnFromEdit(
    { priorFormatted: 'コサさん取れますか', newFormatted: '保坂さん取れますか' },
    { getOccurrence: async () => 5, getReadings: NO_PYKAKASI }); // コサ→こさ(kata2hira, 2モーラ)
  expect(r.learned).toBe(0);
  expect(r.extracted).toBe(1);
  expect(r.gateRejected).toBe(1);
});
