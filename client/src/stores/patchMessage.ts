/**
 * #346 候補6: 1件のメッセージだけを差し替える (純関数)。
 *
 * messageStore の 7 メソッドが同型で書いていた
 * `messages.map(m => m.id === id ? { ...m, patch } : m)` を畳む。
 *
 * ★ addMessage の重複排除 (`some(m => m.id === ...)`) はここに畳み込まない。
 *   あれは「同じ id を後から足さない」という別の判断で、再接続時の message:new
 *   二重配信を吸収する装置 (docs/05)。形が似ているだけで役割が違う。
 *
 * patch に関数を渡すと既存のメッセージを読んで部分マージできる (updateTranscription)。
 * 該当 id が無ければ全要素の参照をそのまま返す (無駄な再描画を作らない)。
 */
export function patchMessage<T extends { id: string }>(
  messages: T[],
  messageId: string,
  patch: Partial<T> | ((m: T) => Partial<T>),
): T[] {
  return messages.map((m) =>
    m.id === messageId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m
  );
}
