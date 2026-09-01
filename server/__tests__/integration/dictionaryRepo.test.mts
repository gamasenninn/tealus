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

/**
 * ★ #375 語(term)の取り消しと、それが import で復活しないこと。
 *
 * 別名(alias)側には最初から tombstone ガード (`WHERE status <> 'rejected'`) があるのに、
 * ★ 語側の upsertTerm には無く `status = EXCLUDED.status` で無条件に上書きしていた。
 * → 取り消した語が、次の organon 取り込みで黙って active に戻る。
 * 実例: 2026-07-05 に手入力された `ガマ / マンタ` 等 3 行を取り消す手段が無く、
 *       266 語の用語リスト (音声認識へ渡る) に載り続けていた。
 */
describe('語(term)の取り消し (#375)', () => {
  test('setTermStatus で rejected にできる', async () => {
    const t = await repo.upsertTerm({ term: '保坂', reading: 'ほさか' });
    const r = await repo.setTermStatus(t.id, 'rejected');
    expect(r!.status).toBe('rejected');
    expect(r!.id).toBe(t.id);
  });

  test('存在しない id は null', async () => {
    expect(await repo.setTermStatus('00000000-0000-4000-8000-000000000000', 'rejected')).toBeNull();
  });

  test('★ 取り消した語は listActiveVocabulary から消える (用語リストに載らない)', async () => {
    const t = await repo.upsertTerm({ term: '把握 / 把握しておく', reading: 'はあく / はあくしておく' });
    await repo.upsertTerm({ term: '保坂', reading: 'ほさか' });
    await repo.setTermStatus(t.id, 'rejected');
    const vocab = await repo.listActiveVocabulary();
    expect(vocab.map((v) => v.term)).toEqual(['保坂']);
  });

  test('★★ tombstone(rejected) の語は upsertTerm で復活しない (別名側と同じ約束)', async () => {
    const t = await repo.upsertTerm({ term: 'ガマ / マンタ', reading: 'がま / まんた', source: 'manual' });
    await repo.setTermStatus(t.id, 'rejected');
    // organon の取り込みが同じ語を active で持ってくる
    const back = await repo.upsertTerm({ term: 'ガマ / マンタ', reading: 'がま / まんた', source: 'organon', status: 'active' });
    expect(back.id).toBe(t.id);          // 行は同じ
    expect(back.status).toBe('rejected'); // ★ 却下は維持される
    expect((await repo.listActiveVocabulary()).map((v) => v.term)).not.toContain('ガマ / マンタ');
  });

  test('取り消していない語は従来どおり upsertTerm で更新される (後方互換)', async () => {
    const a = await repo.upsertTerm({ term: '保坂', category: 'person' });
    const b = await repo.upsertTerm({ term: '保坂', category: 'person', reading: 'ほさか', status: 'active' });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('active');
    expect(b.reading).toBe('ほさか');
  });

  test('★ 人間が明示的に戻すのは通る (setTermStatus は tombstone を見ない)', async () => {
    const t = await repo.upsertTerm({ term: '保坂', reading: 'ほさか' });
    await repo.setTermStatus(t.id, 'rejected');
    const back = await repo.setTermStatus(t.id, 'active');
    expect(back!.status).toBe('active');
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

  /**
   * ★ organon の pull は 既存 alias の来歴を上書きしない。
   *
   * これは `ON CONFLICT DO UPDATE SET` に `source` が **無い** ことで成り立っている
   * (= 書いてある約束ではなく、書いていないことによる約束)。SET 句に `source` を
   * 足すと静かに壊れ、**人が足した alias が organon 由来に見えるようになる**。
   *
   * 2026-09-01 に実機で依存が確認された: organon が `大阪` を canon に追加 → pull
   * (12:43:00) が既存の manual 行に当たったが、`source='manual'` / `count=7` のまま
   * `updated_at` だけが動いた。sync は `count: 0` で来るので加算も効かない。
   *
   * ★ なお `upsertTerm` は逆で、`source = EXCLUDED.source` を持つ (= 上書きする)。
   *   非対称だが現時点で実害 0 件 (どちらの向きも 0)。揃えるかは未決なので、
   *   ここでは **alias 側の現状だけ** を固定する。
   */
  test('★ organon の pull は manual alias の source を上書きしない (count 0 加算 / updated_at のみ)', async () => {
    const first = await repo.upsertAlias({ termId: term.id, alias: '大阪', source: 'manual', count: 7 });
    expect(first.row!.source).toBe('manual');
    expect(first.row!.count).toBe(7);

    // organon dock と同じ呼び方 (scripts/sync_organon_dict.mts:38)
    const pulled = await repo.upsertAlias({ termId: term.id, alias: '大阪', source: 'organon', count: 0 });

    expect(pulled.applied).toBe(true);
    expect(pulled.row!.id).toBe(first.row!.id);   // 行は 1 本のまま
    expect(pulled.row!.source).toBe('manual');    // ★ 来歴は保たれる
    expect(pulled.row!.count).toBe(7);            // ★ count: 0 なので加算されない
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
