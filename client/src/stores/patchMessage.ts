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
/**
 * #501 その投稿を引用しているリプライの「引用の写し」を書き換える (純関数)。
 * ★ 引用は元の投稿の写しを持っているので、元だけ直すと開いたままの画面に古い中身が残る。
 *   該当が無ければ要素の参照はそのまま (無駄な再描画を作らない)。
 */
export function patchQuotes<T extends { id: string; reply_to_message?: { id: string; is_deleted?: boolean } | null }>(
  messages: T[],
  quotedId: string,
  patch: Partial<NonNullable<T['reply_to_message']>>,
): T[] {
  // ★ 削除済みの引用は書き換えない (遅れて来た文字起こしで、消した中身が戻らないように)
  return messages.map((m) =>
    m.reply_to_message?.id === quotedId && !m.reply_to_message.is_deleted
      ? { ...m, reply_to_message: { ...m.reply_to_message, ...patch } } : m
  );
}

export function patchMessage<T extends { id: string }>(
  messages: T[],
  messageId: string,
  patch: Partial<T> | ((m: T) => Partial<T>),
): T[] {
  return messages.map((m) =>
    m.id === messageId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m
  );
}
