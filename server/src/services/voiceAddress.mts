/**
 * 音声の冒頭の呼びかけ (宛名) — 編集画面の「宛名の候補」の元。
 *
 * ★ 無線の手直しの 6 割強は冒頭の宛名だった (2026-10-09〜16 の 7 日: 336 便中 123 便を 1 人が手直し)。
 *   宛名は「ガマさん」「中さん」「お店側」のような**現場の呼び名**で、利用者の名簿には無い。
 *   だから候補は名簿からではなく、**その部屋で人が直した版**から多い順に取る (設定が要らず、使うほど育つ)。
 * ★ 会社の呼び名を本体に書かないため、ここには規則だけを置く。
 * ★★ 同じ規則が client/src/utils/voiceAddress.ts にある (差し替える位置の判定)。変えるときは両方。
 */

/**
 * 呼びかけの印。これで終わる冒頭だけを宛名とみなす (印の無い呼び捨ては、誤って差し替えないよう拾わない)。
 * ★ 「様」は入れない (10-16)。「お客様、到着しました」「お疲れ様。」の冒頭まで差し替えていた
 *   (30 日の無線で 7〜10 便)。人の版の候補に「様」は 1 つも出ないので、候補は減らない
 */
const MARK = '(?:さん|君|くん|ちゃん|側|長)';
/** 冒頭から印までは 1〜8 字。印の直後は区切りか「取れ/とれ」か文の終わり */
const LEADING = new RegExp(`^([^、。,，.\\s？?！!]{1,8}?${MARK})(?=[、。,，.\\s？?！!]|取れ|とれ|[A-Za-z]|$)`);

/** 冒頭の呼びかけ。無ければ null */
export function leadingAddress(text: string): string | null {
  const m = LEADING.exec(text.trim());
  return m ? m[1] : null;
}

export interface AddressCount { text: string; count: number }

/** 文字起こしの一覧から、冒頭の呼びかけを多い順に。1 回しか出ないものは外す (打ち間違いや一度きりの名前を並べない) */
export function rankAddresses(texts: string[], limit = 16): AddressCount[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const a = leadingAddress(t);
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}
