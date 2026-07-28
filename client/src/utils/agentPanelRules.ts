/**
 * #354 🤖 パネルの判断規則 (純関数)。
 *
 * 「開くか / 直挿入か」「`/` で開くか」「どう差し込むか」の 3 つは仕様の核なので、
 * MessageInput の配線から切り離してここに置く。
 */

/**
 * 🤖 を押したときにパネルを開くか。
 *
 * 選ぶものが無い (履歴 0 件かつ宛先 1 つ) なら開かず、従来どおり 1 タップで
 * `@アシスタント ` を即挿入する。使い込んで履歴が溜まるとパネルが現れる形にして、
 * 初見のユーザーに選択肢を突きつけない。
 */
export function shouldOpenAgentPanel({ historyCount, targetCount }: { historyCount: number; targetCount: number }): boolean {
  if (targetCount === 0) return false;
  return historyCount > 0 || targetCount > 1;
}

/**
 * `/` でパネルを開くか。
 *
 * 入力欄が空のときだけに限定する。`docs/05_実装ノート.md` や `src/app.mts` のような
 * パスを日常的に打つので、カーソル位置を問わず開くと誤爆が止まらない。
 * スマホは日本語 IME で記号が打ちにくく全角「／」も混ざるため対象外 (🤖 ボタンを使う)。
 */
export function shouldTriggerSlash(
  { prevText, nextText, isDesktop, assistantInRoom }:
  { prevText: string; nextText: string; isDesktop: boolean; assistantInRoom: boolean }
): boolean {
  return isDesktop && assistantInRoom && prevText === '' && nextText.startsWith('/');
}

/**
 * 選んだ指示を入力欄にどう入れるか。
 *
 * 入力欄が空なら置き換え、書きかけがあれば末尾に足す。`/` で開いた場合は入力欄の中身が
 * 絞り込み文字列 (`/24h` 等) なので、まるごと捨てる。
 */
export function mergePromptInsertion(prevText: string, content: string, slashMode: boolean): string {
  const base = slashMode ? '' : prevText.trimEnd();
  return base ? `${base} ${content}` : content;
}
