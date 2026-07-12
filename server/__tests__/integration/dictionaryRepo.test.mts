/**
 * #327 変換辞書 repository (dictionary_terms / dictionary_aliases) の DB テスト。
 *
 * repo は素の行アクセスに徹する（precedence/パラダイム裁定は loader 段の責務）。
 * 肝は upsertAlias の tombstone 尊重 + count 加算。
 */
import * as repo from '../../src/services/dictionaryRepo.mts';
import { setupTestDb, closeTestDb, getTestPool } from '../helpers/db.mts';
import { pool } from '../../src/db/pool.mts';

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await closeTestDb();
  await pool.end();
});

beforeEach(async () => {
  await getTestPool().query('TRUNCATE dictionary_aliases, dictionary_terms CASCADE');
});

describe('upsertTerm', () => {
  test('新規 term を挿入し既定値が入る', async () => {
    const t = await repo.upsertTerm({ term: '保坂', category: 'person', reading: 'ほさか' });
    expect(t.id).toBeTruthy();
    expect(t.term).toBe('保坂');
    expect(t.category).toBe('person');
    expect(t.reading).toBe('ほさか');
    expect(t.source).toBe('manual');
    expect(t.status).toBe('active');
  });

  test('同名 term は id を保ったまま更新（term で一意）', async () => {
    const a = await repo.upsertTerm({ term: '保坂', category: 'person' });
    const b = await repo.upsertTerm({ term: '保坂', category: 'person', reading: 'ほさか', description: '整備部主任' });
    expect(b.id).toBe(a.id);
    expect(b.reading).toBe('ほさか');
    expect(b.description).toBe('整備部主任');
  });

  test('reading/description の null は既存値を消さない（COALESCE）', async () => {
    await repo.upsertTerm({ term: '保坂', reading: 'ほさか', description: '整備部主任' });
    const b = await repo.upsertTerm({ term: '保坂', category: 'person' }); // reading/desc 未指定
    expect(b.reading).toBe('ほさか');
    expect(b.description).toBe('整備部主任');
  });
});

describe('getTermByName', () => {
  test('存在すれば行、無ければ null', async () => {
    await repo.upsertTerm({ term: '保坂' });
    expect((await repo.getTermByName('保坂'))!.term).toBe('保坂');
    expect(await repo.getTermByName('居ない')).toBeNull();
  });
});

describe('upsertAlias', () => {
  let term: Awaited<ReturnType<typeof repo.upsertTerm>>;
  beforeEach(async () => { term = await repo.upsertTerm({ term: '保坂', reading: 'ほさか' }); });

  test('新規 alias を挿入（source/count 反映、applied=true）', async () => {
    const { row, applied } = await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    expect(applied).toBe(true);
    expect(row!.alias).toBe('ホタカ');
    expect(row!.source).toBe('auto');
    expect(row!.count).toBe(1);
    expect(row!.status).toBe('active');
  });

  test('同一 (term,alias) は重複せず count が加算される', async () => {
    await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    const { row } = await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    expect(row!.count).toBe(2);
    const { rows } = await getTestPool().query('SELECT COUNT(*)::int n FROM dictionary_aliases');
    expect(rows[0].n).toBe(1);
  });

  test('★tombstone(rejected) は尊重して no-op（applied=false、count 不変）', async () => {
    const { row } = await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 3 });
    await repo.setAliasStatus(row!.id, 'rejected');
    const res = await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    expect(res.applied).toBe(false);
    expect(res.row!.status).toBe('rejected');
    expect(res.row!.count).toBe(3); // 加算されない
  });

  test('manual と auto は別 alias として同じ term に共存', async () => {
    await repo.upsertAlias({ termId: term.id, alias: 'ほさか', source: 'manual', count: 0 });
    await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    const { rows } = await getTestPool().query('SELECT COUNT(*)::int n FROM dictionary_aliases WHERE term_id=$1', [term.id]);
    expect(rows[0].n).toBe(2);
  });
});

describe('setAliasStatus', () => {
  test('status を rejected に更新（tombstone 化）', async () => {
    const term = await repo.upsertTerm({ term: '保坂' });
    const { row } = await repo.upsertAlias({ termId: term.id, alias: 'ホタカ', source: 'auto', count: 1 });
    const updated = await repo.setAliasStatus(row!.id, 'rejected');
    expect(updated!.status).toBe('rejected');
  });
});

describe('listActiveVocabulary', () => {
  test('active term＋active alias を grouped で返し、rejected を除外', async () => {
    const hosaka = await repo.upsertTerm({ term: '保坂', category: 'person', reading: 'ほさか' });
    await repo.upsertAlias({ termId: hosaka.id, alias: 'ホタカ', source: 'auto', count: 5 });
    const rej = await repo.upsertAlias({ termId: hosaka.id, alias: 'おたか', source: 'auto', count: 1 });
    await repo.setAliasStatus(rej.row!.id, 'rejected'); // 除外されるべき

    const ozaki = await repo.upsertTerm({ term: '尾崎', category: 'person' });
    await repo.upsertAlias({ termId: ozaki.id, alias: 'オサキ', source: 'auto', count: 3 });

    const rejTerm = await repo.upsertTerm({ term: '却下語', status: 'rejected' }); // term ごと除外
    await repo.upsertAlias({ termId: rejTerm.id, alias: 'X', source: 'auto', count: 1 });

    const vocab = await repo.listActiveVocabulary();
    const byTerm = Object.fromEntries(vocab.map((v) => [v.term, v]));
    expect(Object.keys(byTerm).sort()).toEqual(['保坂', '尾崎']);
    expect(byTerm['保坂'].aliases).toEqual(['ホタカ']); // おたか(rejected)は除外
    expect(byTerm['保坂'].reading).toBe('ほさか');
    expect(byTerm['尾崎'].aliases).toEqual(['オサキ']);
  });
});
