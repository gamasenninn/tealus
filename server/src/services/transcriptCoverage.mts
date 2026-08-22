/**
 * raw 文字起こし ↔ 整形済み議事録 の文単位カバレッジ (#377 の測定支援)
 *
 * ★ 何を解く道具か: 議事録 v1 が raw の文を **丸ごと落とす** ことがある。
 *   2026-08-22 に organon 班が目視で 1 件見つけたが、目視で気づいた件だけを数えると
 *   「0 件」が「落ちなかった」なのか「見ていない」なのか区別できない。
 *   欄を先に作ると意味のない 0 が並ぶので、**先に照合手順を作る**ことにした
 *   (本体班の判断、2026-08-22)。ここはその照合の側。
 *
 * ★ binary 判定を返さない: 整形は言い換え・フィラー除去・固有名詞の正規化を伴うので、
 *   「一致した / しなかった」は決まらない。raw の各文について
 *   **出力側にどれだけ痕跡が残っているか** を 0..1 で出し、昇順に並べるだけにする。
 *   閾値は実データを数日見てから決める。**先に閾値を置くと、置いた値が結論になる**。
 *
 * ★ 指標に最長共通部分文字列を使う理由: 文字 n-gram の被覆率だと「です・ます・から」等の
 *   汎用片が常に当たり、落ちた文でも 0.4 前後まで浮いて差が潰れる。連続一致の最長長は
 *   内容語の並びが残っているかを直接見るので、言い換え耐性を保ったまま脱落と分離できる。
 */

/** 句点・感嘆・疑問・改行で文に切る。空文は落とす。 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[。！？!?])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * a と b に共通する最長の連続部分文字列の長さ。
 *
 * ★ 長さ L で二分探索し、各 L では b の L-gram 集合に a の L-gram が入るかを見る。
 *   素朴な DP は O(|a|×|b|) で、議事録 1 本 (2 万字級) × 文数 だと重い。
 */
export function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const hasCommon = (len: number): boolean => {
    if (len === 0) return true;
    if (len > a.length || len > b.length) return false;
    const grams = new Set<string>();
    for (let i = 0; i + len <= b.length; i++) grams.add(b.slice(i, i + len));
    for (let i = 0; i + len <= a.length; i++) if (grams.has(a.slice(i, i + len))) return true;
    return false;
  };
  let lo = 0;
  let hi = Math.min(a.length, b.length);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (hasCommon(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 比較用の正規化。★ 閾値をいじる代わりに、**既知の変形を先に潰す**。
 *
 * 整形は必ず (a) 句読点・空白・括弧を打ち直し (b) 数字を桁区切りつき表記にする。
 * これを揃えずに比べると、残っているのに短い数字の文が「痕跡が無い」側へ落ちる
 * (2026-08-22 の実データで `売りかけが1782万。` が 0.455 に沈んだ)。
 * ★ 出力に見せる文は元のまま。正規化するのは照合の内側だけ。
 */
export function normalizeForCompare(text: string): string {
  if (!text) return '';
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[、。．，,.\s・「」『』（）()［］\[\]〜~ー―−\-!！?？:：;；'"”“]/g, '')
    .replace(/(\d)[,，](?=\d)/g, '$1')
    .replace(/円/g, '');
}

/** raw の 1 文が formatted 全体にどれだけ残っているか (0..1)。 */
export function coverageOf(sentence: string, formatted: string): number {
  const a = normalizeForCompare(sentence);
  if (!a) return 0;
  return longestCommonSubstringLength(a, normalizeForCompare(formatted)) / a.length;
}

export interface SentenceCoverage {
  /** raw 内での出現順 (0 始まり)。並べ替えても元位置が分かるように保持する */
  index: number;
  sentence: string;
  /** 0..1。小さいほど「出力に痕跡が無い」 */
  coverage: number;
}

/**
 * raw の全文を照合し、カバレッジ昇順で返す。
 *
 * ★ 返すのは順位だけで、「脱落 N 件」とは言わない。件数を出すのは閾値を決めた後。
 */
export function analyzeCoverage(raw: string, formatted: string): SentenceCoverage[] {
  const rows = splitSentences(raw).map((sentence, index) => ({
    index,
    sentence,
    coverage: coverageOf(sentence, formatted),
  }));
  return rows.sort((x, y) => x.coverage - y.coverage || x.index - y.index);
}
