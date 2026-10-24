import type { Message } from '../types';

/**
 * 「エージェントに送る」で送った音声かを、読み込んだ便から決める (2026-10-24 小野さん判断)。
 * 送った音声は文字起こしを畳む (送った文字の便と同じ文が 2 回並ぶ違和感を消す)。DB は変えない。
 *
 * 見分け: 同じ人がその音声に返信していて、返信の先頭が @アシスタント か @cc-〇〇
 * (「エージェントに送る」は元の音声への返信の形で、先頭に宛先を入れる — MessageInput の入口 B)
 */
export function isSentToAgent(voice: Message, messages: Message[] | null | undefined, assistantName: string | null | undefined): boolean {
  if (voice.type !== 'voice' || !Array.isArray(messages)) return false;
  return messages.some((m) =>
    m.reply_to === voice.id &&
    m.sender_id === voice.sender_id &&
    !m.is_deleted &&
    startsWithAgentMention(m.content, assistantName));
}

function startsWithAgentMention(content: string | null | undefined, assistantName: string | null | undefined): boolean {
  const head = /^@(\S+)/.exec(content || '')?.[1];
  if (!head) return false;
  return head.startsWith('cc-') || (!!assistantName && head === assistantName);
}

/**
 * 選んだ宛先を 1 行目に並べる。★ @アシスタント は先頭でないと応答しないので、選んだ中にあれば先頭に置く。
 * ほかは選んだ順 (受け取り側は 1 行目にスペース区切りで並べれば 5 班まで起こせる)
 */
export function orderAgentMentions(names: string[], assistantName: string | null | undefined): string {
  const first = names.filter((n) => !!assistantName && n === assistantName);
  const rest = names.filter((n) => !(assistantName && n === assistantName));
  return [...first, ...rest].map((n) => `@${n}`).join(' ');
}
