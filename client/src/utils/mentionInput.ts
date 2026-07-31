/**
 * #346 候補2 (縮退版) @メンションの検知と挿入 (純関数)。
 *
 * MessageInput の textarea onChange / MentionPicker onSelect に JSX 内インラインで
 * 書かれていたカーソル計算をここに出す。
 *
 * ★ 挿入結果の先頭形式は agent-server の `isMentioned`
 *   (`new RegExp('^@' + name)` / 先行空白のみ許容、agent-server/src/webhook/mention.mts)
 *   が読む契約。ここが崩れると mention してもエージェントが起動しない。しかも画面上は
 *   正常に見える (メッセージは普通に投稿される) ので気づけない類なので、テストで
 *   文字列レベルに固定してある。
 */

/** カーソル直前で打ちかけの @query を検知する。null = picker を出さない */
export function detectMentionQuery(value: string, cursorPos: number): string | null {
  const textBefore = value.slice(0, cursorPos);
  // @ の後に空白・別の @ が来るまでを query とする。素の `@` は空 query (候補を全件出す)
  const m = textBefore.match(/@([^\s@]*)$/);
  return m ? m[1] : null;
}

/**
 * 打ちかけの `@...` を選ばれた宛先で置き換える。
 * cursor は挿入した宛先の直後 (`@` + 名前 + 空白)。@ が無ければ null (呼び手は何もしない)。
 */
export function insertMentionAtCursor(
  text: string, cursorPos: number, name: string,
): { text: string; cursor: number } | null {
  const textBefore = text.slice(0, cursorPos);
  const textAfter = text.slice(cursorPos);
  const atIdx = textBefore.lastIndexOf('@');
  if (atIdx < 0) return null;
  return {
    text: `${textBefore.slice(0, atIdx)}@${name} ${textAfter}`,
    cursor: atIdx + name.length + 2,  // @ + 名前 + 末尾空白
  };
}
