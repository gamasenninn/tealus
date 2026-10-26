/**
 * LINE の便の本文を、部屋の便にする形に整える (routes/line.mts から使う)
 */

/**
 * 行頭の @ を全角の ＠ にする (2026-10-26 小野さん判断、セキュリティチェックループの B)。
 * ★ LINE のグループには Tealus の利用者でない人もいる。@cc-〇〇 (班を起こす)・別名・@アシスタント は
 *   どれも「行頭の @」で起きるので、ここで全部止める。全角なら、読む人には書いてあったことがそのまま見える
 */
export function neutralizeLineMentions(text: string): string {
  return text.replace(/^([ \t　]*)@/gm, '$1＠');
}

/**
 * content 先頭に「[ラベル]」を付与する (= #309 案A)。
 * - label が null/空 → body をそのまま返す (= 従来挙動、body は undefined もあり得る)
 * - body あり → 「[label]\n本文」、body 無し (= media caption) → 「[label]」
 * - ★ 本文の行頭の @ は ＠ にする (neutralizeLineMentions)
 */
export function applyContentLabel(label: string | null | undefined, body: string): string;
export function applyContentLabel(label: string | null | undefined, body: string | undefined): string | undefined;
export function applyContentLabel(label: string | null | undefined, body: string | undefined): string | undefined {
  const safe = body === undefined ? undefined : neutralizeLineMentions(body);
  if (!label) return safe;
  const head = `[${label}]`;
  return (safe && safe.length > 0) ? `${head}\n${safe}` : head;
}
