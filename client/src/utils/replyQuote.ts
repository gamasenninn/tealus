/** #586 スタンプの本文はスタンプの ID (UUID)。画面には出さず、通知と同じ文字にする */
export const STAMP_LABEL = '🙂 スタンプ';

/**
 * #501 リプライの引用に出す文字。
 * ★ 削除済みは「(メディア)」と出さない (削除ではなく画像か何かに見えていた)。
 *   本文が残っていても出さない (サーバーは空にして返すが、古い写しが残っていることがある)
 * ★ #586 スタンプは UUID を出さない
 */
export function quoteText(q: { content: string | null; is_deleted?: boolean; type?: string }): string {
  if (q.is_deleted) return 'メッセージが削除されました';
  if (q.type === 'stamp') return STAMP_LABEL;
  return q.content || '(メディア)';
}

/**
 * トーク一覧の最後の投稿のプレビュー (RoomList から切り出し)。
 * ★ #586 スタンプは本文が UUID なので、種類で「🙂 スタンプ」と出す (利用者の声 10-12)
 */
export function roomPreview(room: { last_message_type?: string | null; last_message_content?: string | null }): string {
  if (room.last_message_type === 'stamp') return STAMP_LABEL;
  if (!room.last_message_content && room.last_message_type) {
    const typeLabels: Record<string, string> = { image: '画像', video: '動画', file: 'ファイル' };
    return typeLabels[room.last_message_type] || '';
  }
  return room.last_message_content || '';
}
