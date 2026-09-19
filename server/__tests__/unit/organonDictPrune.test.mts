/**
 * #381 掃除 (prune) の判定 unit test。
 *
 * ★ この関数が存在する理由 = 2026-08-27 に手書き SQL で消したときの事故。
 *   条件を `dictionary_terms.source = 'organon'` (= 用語の出所) で書いたため、
 *   organon 由来の用語にぶら下がる auto / manual の alias 53 件を巻き添えで消した。
 *   正しい条件は **alias 自身の出所** で絞ること。ここを取り違えると、
 *   現場で学習した聞き取り揺れ (STT 補正に効いている側) が消える。
 */
import { selectPrunableAliases, type AliasRow } from '../../scripts/organonDictPrune.mts';
import type { ProjectedTerm } from '../../scripts/organonDictProjection.mts';

const projected: ProjectedTerm[] = [
  { term: '五月女', category: 'person', aliases: ['ソウトメ', '早乙女'] },
  { term: '神山', category: 'person', aliases: ['上山'] },
];

describe('selectPrunableAliases', () => {
  it('射影に含まれない organon の alias を削除対象にする', () => {
    const rows: AliasRow[] = [
      { term: '五月女', alias: '五月女', source: 'organon' }, // 恒等 = 射影が落とす
      { term: '五月女', alias: 'ソウトメさん', source: 'organon' }, // 敬称重複 = 射影が落とす
    ];
    expect(selectPrunableAliases(projected, rows)).toEqual(rows);
  });

  it('★ auto / manual の alias は、射影に無くても削除しない', () => {
    const rows: AliasRow[] = [
      { term: '五月女', alias: 'ソソメ', source: 'auto' },
      { term: '神山', alias: 'カミヤマ', source: 'manual' },
    ];
    expect(selectPrunableAliases(projected, rows)).toEqual([]);
  });

  it('射影に含まれる organon の alias は残す', () => {
    const rows: AliasRow[] = [
      { term: '五月女', alias: 'ソウトメ', source: 'organon' },
      { term: '神山', alias: '上山', source: 'organon' },
    ];
    expect(selectPrunableAliases(projected, rows)).toEqual([]);
  });

  it('射影に無い用語にぶら下がる organon の alias も削除対象にする (型/status で落ちた用語)', () => {
    const rows: AliasRow[] = [{ term: '旧会社', alias: '旧', source: 'organon' }];
    expect(selectPrunableAliases(projected, rows)).toEqual(rows);
  });

  it('同じ alias 文字列でも、用語が違えば別々に判定する', () => {
    const rows: AliasRow[] = [
      { term: '五月女', alias: '上山', source: 'organon' }, // 五月女 の射影に 上山 は無い
      { term: '神山', alias: '上山', source: 'organon' }, // 神山 の射影には有る
    ];
    expect(selectPrunableAliases(projected, rows)).toEqual([rows[0]]);
  });

  it('★ 既に tombstone 済みの alias は、もう対象にしない (#384)', () => {
    // ★ 撤去を DELETE から tombstone に変えると、落とした行が **DB に残り続ける**。
    //   status を見ずに選ぶと、同じ行を毎回「対象」に数え続けて収束しない。
    //   件数の上限 (planRetraction の 5 件) を、済んだ分だけで食い潰すことにもなる。
    //   ★ 2026-09-14 時点で organon の alias tombstone は実データに 2 件あった。
    const rows: AliasRow[] = [
      { term: '旧会社', alias: '旧', source: 'organon', status: 'rejected' },
      { term: '旧会社', alias: 'きゅう', source: 'organon', status: 'active' },
    ];
    expect(selectPrunableAliases(projected, rows)).toEqual([rows[1]]);
  });

  it('status が無い行は active とみなす (既存の呼び出しを壊さない)', () => {
    const rows: AliasRow[] = [{ term: '旧会社', alias: '旧', source: 'organon' }];
    expect(selectPrunableAliases(projected, rows)).toEqual(rows);
  });
});

/**
 * ★ #384 撤去対象の alias を名指しする (2026-09-19)。
 *
 * ★ なぜ要るか = 2026-09-19 の実地で起きたこと。
 *   term 側は 1 行ずつ列挙するのに alias 側は件数しか出さないので、
 *   `--apply` の直前に **何が消えるのか分からない**。
 *   この日は curator が「victim を確定できていない」と承知のうえで判断し、
 *   撤去した後に local.ttl の差分を取って初めて名前が分かった。
 *   ★★ 消えたものは後から数えられない。**撃つ前に名前を出す**。
 */
import { formatPrunableAliases } from '../../scripts/organonDictPrune.mts';

describe('formatPrunableAliases', () => {
  it('撤去対象を term ← alias の形で 1 行ずつ出す', () => {
    const rows: AliasRow[] = [
      { term: '飛行船', alias: '飛行船アグリ', source: 'organon' },
      { term: '五月女', alias: 'ソウトメさん', source: 'organon' },
    ];
    expect(formatPrunableAliases(rows)).toEqual([
      '  - 飛行船 ← 飛行船アグリ',
      '  - 五月女 ← ソウトメさん',
    ]);
  });

  it('対象が無ければ 1 行も出さない', () => {
    expect(formatPrunableAliases([])).toEqual([]);
  });

  it('★ 上限を超えたら「黙って切らない」— 省いた件数を出す', () => {
    const rows: AliasRow[] = Array.from({ length: 5 }, (_, i) => ({
      term: 't' + i,
      alias: 'a' + i,
      source: 'organon',
    }));
    const out = formatPrunableAliases(rows, 3);
    expect(out).toHaveLength(4);
    expect(out.slice(0, 3)).toEqual(['  - t0 ← a0', '  - t1 ← a1', '  - t2 ← a2']);
    expect(out[3]).toContain('2');
    expect(out[3]).toMatch(/省|残|他/);
  });
});
