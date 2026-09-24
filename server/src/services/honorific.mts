/**
 * 末尾の敬称を外す規則 (2026-09-24 にここへ出した)。★ **依存を 1 つも持たない。**
 *
 * ★ なぜ独立した file か: 同じ規則を **2 つのパッケージ**から使う ——
 *   ① `server/scripts/organonDictProjection.mts` … 射影が敬称つき別名を **畳む**側
 *   ② `agent-server/src/lib/confirmMarks.mts`    … 畳まれた台帳を **引く**側
 *   ★★ 同じ表を 2 か所に置くと、片方に敬称を足したときに静かにずれる。
 *
 * ★★★★★ **`organonDictProjection.mts` から import してはいけない。**
 *   あちらは `n3` を読むので、★ agent-server の CI ジョブ (server の node_modules が無い) で
 *   `TS2307: Cannot find module 'n3'` になる。★★ 2026-09-24 に実際に 5 回 赤にした。
 *   ★★★ 手元では server/node_modules が見えるので通ってしまう = **手元では捕まらない**。
 */

/**
 * 敬称 (#381)。★ **長いものから試す** —— 「くん」と「君」のように片方が他方の部分でなくても、
 * 将来足したときに短い方が先に当たる事故を防ぐため、長さ降順で固定する。
 */
export const HONORIFICS = ['ちゃん', 'さま', 'さん', 'くん', '様', '君'] as const;

/** 末尾の敬称を 1 つだけ外した形。敬称が無い / 外すと空になるなら null */
export function stripHonorific(s: string): string | null {
  for (const h of HONORIFICS) {
    if (s.length > h.length && s.endsWith(h)) return s.slice(0, -h.length);
  }
  return null;
}
