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
const MEDIA_LABELS: Record<string, string> = { image: '画像', video: '動画', file: 'ファイル', voice: '音声' };   // ★ #588 voice を足した

export function roomPreview(room: { last_message_type?: string | null; last_message_content?: string | null }): string {
  const type = room.last_message_type;
  const content = room.last_message_content;
  if (type === 'stamp') return STAMP_LABEL;
  const label = type ? MEDIA_LABELS[type] : undefined;
  if (!content) return label || '';
  // ★ #588 LINE の媒体は本文が「[氏名@グループ]」だけ (routes/line.mts applyContentLabel)。種類を添えないと写真と分からない
  if (label && /^\[[^\]\n]+\]$/.test(content)) return `${content} ${label}`;
  return content;
}

/**
 * ★ #588 返信を書くときの入力欄の上のバー。スタンプは UUID を出さない (#586 の取り残し)。
 *   音声は文字起こし (整形 → 無ければ生)、何も無ければ「(メディア)」(以前の MessageInput と同じ)
 */
export function replyBarText(m: {
  type?: string; content: string | null;
  transcription?: { formatted_text?: string | null; raw_text?: string | null } | null;
}): string {
  if (m.type === 'stamp') return STAMP_LABEL;
  return m.content || m.transcription?.formatted_text || m.transcription?.raw_text || '(メディア)';
}
