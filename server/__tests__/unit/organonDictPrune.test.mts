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
});
