/**
 * 文字起こし連続編集のナビゲーション用 純粋ロジック (VoiceEditModal で使用)。
 *
 * ルームのメッセージ一覧から「編集可能な音声メッセージ (status=done)」を順序付きで抽出し、
 * 現在の対象を中心に 前/次 の messageId を返す。store / React に依存しないので Vitest 可能。
 */

/** その user が編集可能な、文字起こし完了済みの音声メッセージを順序付きで返す。 */
export function editableVoiceMessages(messages, userId, allowMemberEdit) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (m) =>
      m &&
      m.type === 'voice' &&
      !m.is_deleted &&
      m.transcription?.status === 'done' &&
      (allowMemberEdit || m.sender_id === userId)
  );
}

/** currentId を中心としたナビ情報 (list / index / total / prevId / nextId / current)。 */
export function voiceNav(messages, currentId, userId, allowMemberEdit) {
  const list = editableVoiceMessages(messages, userId, allowMemberEdit);
  const index = list.findIndex((m) => m.id === currentId);
  return {
    list,
    index,
    total: list.length,
    current: index >= 0 ? list[index] : null,
    prevId: index > 0 ? list[index - 1].id : null,
    nextId: index >= 0 && index < list.length - 1 ? list[index + 1].id : null,
  };
}

/** メッセージの文字起こし表示テキスト (整形済み優先、無ければ生テキスト)。 */
export function transcriptionText(msg) {
  return msg?.transcription?.formatted_text || msg?.transcription?.raw_text || '';
}
