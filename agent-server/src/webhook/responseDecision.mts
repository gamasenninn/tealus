/**
 * 振り分け (dispatcher._dispatch) の冒頭「この便に応答するか」の判定。改善ループ 126 で純関数に出した (中身は同じ)。
 * ★ 順番が意味を持つ: 止めた部屋 → ゲスト (#492) → 名指しが要るか。お知らせ・ログ・10 分の間引きは dispatcher 側
 * ★ addressed (宛てた便か: お知らせを出すか) と名指しが要るか (response_mode) は別の式。混ぜないこと
 * テスト: __tests__/unit/responseDecision.test.mts (表)、結線は dispatcher.test
 */
import { isMentioned } from './mention.mts';

export interface RoomSettings { response_mode: string; enabled: boolean }

/** AI に宛てた便か: 1 対 1 (2 人以下)、または先頭で名指し */
export function isAddressed(prompt: string, agentName: string | null | undefined, memberCount: number): boolean {
  return !(memberCount > 2) || isMentioned(prompt, agentName);
}

export type ResponseDecision =
  /** AI を止めた部屋。addressed ならお知らせを 1 行 (2026-10-30 判断 C) */
  | { kind: 'disabled'; addressed: boolean }
  /** #492 ゲストの便には応答しない。addressed ならお知らせ */
  | { kind: 'guest'; addressed: boolean }
  /** 名指しが要るのに無い: 黙る */
  | { kind: 'no_mention' }
  /** 応答する。stripMention なら先頭の名指しを落としてから (extractPrompt) */
  | { kind: 'respond'; stripMention: boolean };

export function decideResponse({ prompt, agentName, memberCount, roomSettings, senderRole }: {
  prompt: string;
  agentName: string | null | undefined;
  memberCount: number;
  roomSettings: RoomSettings;
  senderRole: string | undefined;
}): ResponseDecision {
  if (!roomSettings.enabled || roomSettings.response_mode === 'off') {
    return { kind: 'disabled', addressed: isAddressed(prompt, agentName, memberCount) };
  }
  if (senderRole === 'guest') {
    return { kind: 'guest', addressed: isAddressed(prompt, agentName, memberCount) };
  }
  const needsMention =
    roomSettings.response_mode === 'mention' ? true :
    roomSettings.response_mode === 'all' ? false :
    /* auto */ memberCount > 2;
  if (!needsMention) return { kind: 'respond', stripMention: false };
  if (!isMentioned(prompt, agentName)) return { kind: 'no_mention' };
  return { kind: 'respond', stripMention: true };
}
