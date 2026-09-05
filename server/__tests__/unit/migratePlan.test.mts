import { planMigrations, needsBaseline } from '../../src/db/migrate.mts';

/**
 * #406 migration runner が台帳を持たず、毎回全ファイルを再生していた。
 *
 * ★ 実害: `008_stamps.sql` が `form` を知らない CHECK 制約を張り直そうとして、
 *   026 以降に作られた form 型のメッセージ 155 件に弾かれる。**本番 DB に migrate を流せない。**
 *   → 2026-09-05 に #405 の列を足そうとして踏み、027 は手で当てた。
 *
 * ★★ **空の DB では再現しない** (順に流れて最後に 026 が勝つ)。テストも毎回 drop してから
 *   流していたので、**再生の経路は一度も通っていなかった**。だから気づけなかった。
 */

describe('planMigrations — 未適用だけを選ぶ', () => {
  const all = ['001_a.sql', '002_b.sql', '003_c.sql'];

  it('★ 台帳が空なら全部流す (新規構築)', () => {
    expect(planMigrations(all, new Set())).toEqual(all);
  });

  it('★★ 適用済みは飛ばす (これが無くて毎回全部流していた)', () => {
    expect(planMigrations(all, new Set(['001_a.sql', '002_b.sql']))).toEqual(['003_c.sql']);
  });

  it('全部適用済みなら何も流さない', () => {
    expect(planMigrations(all, new Set(all))).toEqual([]);
  });

  it('★ 順序は保つ (ファイル名の昇順に依存している)', () => {
    expect(planMigrations(['003_c.sql', '001_a.sql', '002_b.sql'], new Set()))
      .toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);
  });

  it('★ 台帳にあるが今は存在しないファイルは無視する (消しても壊れない)', () => {
    expect(planMigrations(all, new Set(['000_removed.sql']))).toEqual(all);
  });
});

describe('needsBaseline — 既存 DB を勝手に「適用済み」にしない', () => {
  /**
   * ★★ ここを推測で埋めない。台帳が無いのに既にテーブルがある DB は、
   *   「全部適用済み」かもしれないし「途中まで」かもしれない。**区別が付かない。**
   *   → 止めて人に決めさせる (fail-loud)。黙って進めると、未適用のものを飛ばして静かに壊れる。
   */
  it('★ 台帳が無く、テーブルもない → 新規構築。そのまま流してよい', () => {
    expect(needsBaseline(false, false)).toBe(false);
  });

  it('★★ 台帳が無いが、テーブルは在る → 止める (baseline が要る)', () => {
    expect(needsBaseline(false, true)).toBe(true);
  });

  it('台帳が在れば、テーブルの有無に関わらず進めてよい', () => {
    expect(needsBaseline(true, true)).toBe(false);
    expect(needsBaseline(true, false)).toBe(false);
  });
});
