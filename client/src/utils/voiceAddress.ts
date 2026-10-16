/**
 * 宛名の候補を文字起こしに当てる (音声の編集画面)。
 *
 * ★ 冒頭に呼びかけがあれば差し替え、無ければ「候補、」を先頭に足す。
 * ★★ 呼びかけの判定は server/src/services/voiceAddress.mts と同じ規則 (候補を数える側)。変えるときは両方。
 *    印の無い冒頭 (「八木沢先生」「はい」) を差し替えないのは、宛名でない語を消さないため。
 */
const MARK = '(?:さん|君|くん|ちゃん|様|側|長)';
const LEADING = new RegExp(`^([^、。,，.\\s？?！!]{1,8}?${MARK})(?=[、。,，.\\s？?！!]|取れ|とれ|[A-Za-z]|$)`);

export function applyAddress(text: string, candidate: string): string {
  const t = text.trimStart();
  const m = LEADING.exec(t);
  if (m) return candidate + t.slice(m[1].length);
  return `${candidate}、${t}`;
}
