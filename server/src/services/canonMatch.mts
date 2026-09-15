/**
 * canon の語が文の中に居るかを照合する。★ **器を 1 つにするための module** (2026-09-15)。
 *
 * ## なぜ要るか
 *
 * ★ 同じ照合の失敗を **1 日で 5 回**踏んだ。全部「canon 側の正規形だけで照合し、崩れを取りこぼす」形:
 * ```
 * 1 #435 の分母を canon の正式名で作った            (機会 9 → 実は 19)
 * 2 独立 STT の出力を漢字の完全一致で照合した        (「どちらも出ず 6 件」→ 実は 5 件は一致)
 * 3 議事録の期間をファイル名の文字列ソートで出した    (9 月の便が消えた)
 * 4 〔要確認〕を全角だけで数えかけた                (半角 [要確認] も在る)
 * 5 alias に `サンペイ` が在るのに `サンペ` で外した
 * ```
 * ★★ **毎回「取りこぼす」方向に外れる**ので、率が良く見えたり悪く見えたりする向きが一定でない。
 *
 * ## ★★★★ 緩めれば良い、ではない
 *
 * 短い表層で 1 字違いを許すと **誤検出を licensed にする**
 * (`count=1 の短い alias が誤変換を licensed にする` と同じ形)。
 * → ★ **3 値で返し、呼び出し側に決めさせる。** 器が勝手に「一致」と言わない。
 *
 * ## 使わない場面
 *
 * ★ **訂正対の分類 (`classifyPair`) には使わない。** あちらは「崩れ側が canon に在るか」を
 *   見る道具で、**在ってはいけない方**を厳密に判定している。緩めると意味が壊れる。
 */

/** 照合の対象。★ 辞書テーブルの 1 語ぶん。 */
export interface CanonEntry {
  term: string;
  reading?: string | null;
  aliases?: string[] | null;
}

export type CanonMatchKind = 'exact' | 'near' | 'none';

export interface CanonMatch {
  kind: CanonMatchKind;
  /** 当たった表層。★ none のときは null */
  surface: string | null;
}

/** ★ near を作ってよい最短の表層長。★★ これより短いと 1 字違いが無関係な語に当たる。 */
const NEAR_MIN_LEN = 3;

/**
 * 照合の内側だけで使う正規化。★ 表に見せる文は元のまま。
 *
 * ★★ 実データで踏んだもの: `高山 さん` (半角空白入り) が canon と完全一致せず、
 *   寄せの対象になったと見られる回があった。**空白と括弧は先に潰す。**
 */
export function normalizeSurface(text: string): string {
  if (!text) return '';
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s・、。．，,.「」『』（）()［］\[\]〔〕{}〜~ー―−\-!！?？:：;；'"”“]/g, '');
}

/**
 * 照合に使う表層を作る。★ **正式名 + 読み + alias を全部**。
 *
 * ★★ 正式名だけで照合しないこと —— それが今日 5 回の失敗の共通形。
 * ★★★ 短すぎる表層は既定で落とす (1 文字の `平` は「平日」に当たる)。
 *   ただし閾値は呼び出し側が動かせる。**器が勝手に決めない。**
 */
export function canonSurfaces(entry: CanonEntry, minLen = 2): string[] {
  const raw = [entry.term, entry.reading || '', ...(entry.aliases || [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const t = (s || '').trim();
    if (t.length < minLen || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 文の中に canon の語が居るか。★ **3 値**。
 *
 * ```
 * exact  ★ 表層のどれかが (正規化のうえで) そのまま在る
 * near   ★★ 表層から 1 字落ちた形が在る (★★★ 表層が 3 字以上のときだけ)
 * none   ★ 当たらない
 * ```
 * ★ `near` を `exact` に混ぜないこと。**混ぜた瞬間に、器が判断を横取りする。**
 */
export function matchCanon(text: string, entry: CanonEntry, minLen = 2): CanonMatch {
  const hay = normalizeSurface(text);
  if (!hay) return { kind: 'none', surface: null };
  const surfaces = canonSurfaces(entry, minLen);

  for (const s of surfaces) {
    if (hay.includes(normalizeSurface(s))) return { kind: 'exact', surface: s };
  }
  // ★ 1 字落ちだけを near にする。★★ 3 字未満では作らない (誤検出を licensed にしない)
  for (const s of surfaces) {
    const n = normalizeSurface(s);
    if (n.length < NEAR_MIN_LEN) continue;
    for (let i = 0; i < n.length; i++) {
      const dropped = n.slice(0, i) + n.slice(i + 1);
      // ★★★★ 落としたあとも 3 字以上あること。★ 2 字まで許すと **敬称に当たる** ——
      //   読み `さんべ` から 1 字落とすと `さん` になり、「サンペさんが」の敬称に当たった
      //   (2026-09-15 にテストで捕まえた。実データに当てる前に出た)。
      if (dropped.length >= NEAR_MIN_LEN && hay.includes(dropped)) {
        return { kind: 'near', surface: s };
      }
    }
  }
  return { kind: 'none', surface: null };
}
