/**
 * 文字起こし連続編集のナビゲーション用 純粋ロジック (VoiceEditModal で使用)。
 *
 * ルームのメッセージ一覧から「編集可能な音声メッセージ (status=done)」を順序付きで抽出し、
 * 現在の対象を中心に 前/次 の messageId を返す。store / React に依存しないので Vitest 可能。
 */
import type { Message } from '../types';

export interface VoiceNavInfo {
  list: Message[];
  index: number;
  total: number;
  current: Message | null;
  prevId: string | null;
  nextId: string | null;
}

/** その user が編集可能な、文字起こし完了済みの音声メッセージを順序付きで返す。 */
export function editableVoiceMessages(messages: Message[] | null | undefined, userId: string, allowMemberEdit: boolean): Message[] {
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

/**
 * #379: 音声添付を持つ、その user が編集可能なメッセージを順序付きで返す。
 *
 * ★ 「編集できるか」は `useContextMenuItems` の `canEditMessage` と**同じ規則**
 *   (`message_edit_policy` の none / sender / member + 削除済み・system・stamp 除外)。
 *   別ルールを書くと「前/次で送った先が保存時に 403」になり、実行時にしか出ない。
 * ★★ `type='voice'` は除く —— あちらは `VoiceEditModal` が既に連続編集を持っており、
 *   含めると同じメッセージに 2 系統のナビができて、開いた場所で挙動が変わる。
 */
export function editableAudioAttachmentMessages(
  messages: Message[] | null | undefined,
  userId: string,
  editPolicy: 'none' | 'sender' | 'member' | undefined,
): Message[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter((m) => {
    if (!m || m.is_deleted) return false;
    if (m.type === 'voice' || m.type === 'system' || m.type === 'stamp') return false;
    const hasAudio = Array.isArray(m.media)
      && m.media.some((x) => typeof x?.mime_type === 'string' && x.mime_type.startsWith('audio/'));
    if (!hasAudio) return false;
    const isOwn = m.sender_id === userId;
    const isFirstCaption = !m.content && isOwn;
    return isFirstCaption || (editPolicy === 'sender' && isOwn) || editPolicy === 'member';
  });
}

/** 一覧と現在地からナビ情報を組む (抽出条件に依存しない部分)。 */
export function navFor(list: Message[], currentId: string): VoiceNavInfo {
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

/** currentId を中心としたナビ情報 (list / index / total / prevId / nextId / current)。 */
export function voiceNav(messages: Message[] | null | undefined, currentId: string, userId: string, allowMemberEdit: boolean): VoiceNavInfo {
  return navFor(editableVoiceMessages(messages, userId, allowMemberEdit), currentId);
}

/** メッセージの文字起こし表示テキスト (整形済み優先、無ければ生テキスト)。 */
export function transcriptionText(msg: Message | null | undefined): string {
  return msg?.transcription?.formatted_text || msg?.transcription?.raw_text || '';
}
