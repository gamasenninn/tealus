/**
 * 通話履歴の本文に入る時刻タグ `[m:ss]` / `[h:mm:ss]` を拾う。
 *
 * ★ SP2TXT が 2026-08-29 17:45 (sum_84340) から本文に出すようになった。**再生位置と一致する**
 *   (user 確認済み) ので、拾った秒数はそのまま `currentTime` に使える。
 *
 * ★ タグの体裁は 1 通の中で 2 通りある (`[0:00] 本文` と `[1:05]` + 改行)。どちらも拾う
 *   —— 直す価値が無いと判断した揺れなので、読む側で吸収する。
 *
 * ★ 秒が 60 以上のものは弾く。`[1:75]` のような並びを時刻と読むと、寸法や型式の記述を
 *   誤ってタグ扱いしうる。**時刻として成立するものだけ**を拾う。
 */
export interface TranscriptMark {
  /** 本文に出ている表記そのまま (ボタンの文字にも使う) */
  label: string;
  /** 先頭からの秒数 */
  seconds: number;
}

const MARK_RE = /\[(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\]/g;

export function parseTimestampMarks(text: string): TranscriptMark[] {
  const out: TranscriptMark[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(MARK_RE)) {
    const [, a, b, c] = m;
    // c があれば h:mm:ss、無ければ m:ss
    const seconds = c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c);
    if (seen.has(seconds)) continue;
    seen.add(seconds);
    out.push({ label: c === undefined ? `${a}:${b}` : `${a}:${b}:${c}`, seconds });
  }
  return out;
}
