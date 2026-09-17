/**
 * 固有名詞の読みを TTS の前段で当てる (#446)
 *
 * ★ なぜ要るか: OpenAI TTS は「鹿沼」を **シカヌマ** と読む (★★ Aivis は カヌマ と読める)。
 *   ★★★ `instructions` で読みを指示しても直らないことを実測済み (2026-09-17)。
 *   → ★ **本文を書き換えるしかない。** ★★ ただし **TTS に渡す文だけ**。保存される本文は変えない。
 *
 * ★★★★★ **一括置換は採らない。**
 *   記憶に「決定論の前段補正は精度≈0%」の実績がある。辞書には読みが 259 語ぶん在るが、
 *   ★ **全部入れると「文脈で読みが変わる固有名詞」を踏む** (★★ 大島=おーしま / 上谷=うえたに /
 *   三瓶=さんべ / 五月女=そうとめ —— 別の意味で同じ字が出たとき、固有名詞の読みを押し付ける)。
 *   → ★★★ **聞いて「読み違える」と確かめた語だけ**を表に足す。★ 段 2 で 1 語ずつ広げる。
 *
 * ★★ これは tealus で **初めての「部分一致の置換器」**になる。
 *   ★★★ それまでは消費 5 経路とも LLM prompt で、決定論の置換は 1 つも無かった。
 *   ★ だから ガード (長い語優先 / 数字除外 / 1 文字除外) と **置換ログ**を最初から入れる。
 *
 * @module lib/tts-reading
 */

/**
 * ★★★★ 置換表 —— **1 語だけから始める** (#446 段 1)。
 *
 * ★ 足してよいのは「**実際に聞いて読み違えると確かめた語**」だけ。
 * ★★ 推測で足さない。★★★ 足した語数はテストで固定してある
 *   (`ttsReading.test.mts` の「既定の表は 1 語だけ」) ので、
 *   ★ **黙って増やすとテストが落ちる。** 増やすときはテストも一緒に直すこと (= 意識的に増やす)。
 */
export const READING_HINTS: Record<string, string> = {
  鹿沼: 'カヌマ',
};

export interface AppliedHint {
  term: string;
  reading: string;
  count: number;
}

export interface ReadingResult {
  text: string;
  /** ★ 何をいくつ置換したか。★★ 黙って書き換えないための記録 */
  applied: AppliedHint[];
}

/** ★ 数字だけの語は対象外 (★★ 「44」が term として登録されており、30 日で 292 回当たっていた) */
const NUMERIC_ONLY = /^[0-9０-９]+$/;

/**
 * 読みを当てる。★ 表に在る語だけが変わり、★★ 他は 1 文字も変わらない。
 *
 * ★★★ 長い語から順に当てる —— ★ 包含 (鹿沼 ⊂ 鹿沼梱包) で短い方が先に当たると、
 *   表に在る長い語の読みが使われなくなる。
 */
export function applyReadingHints(
  text: string,
  hints: Record<string, string> = READING_HINTS,
): ReadingResult {
  if (!text) return { text: '', applied: [] };

  const terms = Object.keys(hints)
    .filter((t) => t.length >= 2)          // ★ 1 文字は substring 雑音が大きすぎる
    .filter((t) => !NUMERIC_ONLY.test(t))  // ★★ 数字だけは対象外
    .sort((a, b) => b.length - a.length);  // ★★★ 長い語が先

  let out = text;
  const applied: AppliedHint[] = [];
  for (const term of terms) {
    const count = out.split(term).length - 1;
    if (count === 0) continue;
    out = out.split(term).join(hints[term]);
    applied.push({ term, reading: hints[term], count });
  }
  return { text: out, applied };
}
