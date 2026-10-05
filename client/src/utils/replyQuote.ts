/**
 * #501 リプライの引用に出す文字。
 * ★ 削除済みは「(メディア)」と出さない (削除ではなく画像か何かに見えていた)。
 *   本文が残っていても出さない (サーバーは空にして返すが、古い写しが残っていることがある)
 */
export function quoteText(q: { content: string | null; is_deleted?: boolean }): string {
  if (q.is_deleted) return 'メッセージが削除されました';
  return q.content || '(メディア)';
}
