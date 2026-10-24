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

/**
 * 入力欄の先頭に並んだ宛先 (targetNames のどれか) を拾う。宛先の帯の「選ばれている」はここから決める
 * (2026-10-24 案 C: 押した宛先がその場で入力欄に入る。入力欄が唯一の正 = 手で消しても帯と食い違わない)
 */
export function leadingAgentMentions(text: string, targetNames: string[]): string[] {
  const names: string[] = [];
  let rest = text;
  for (;;) {
    const m = /^@(\S+)\s*/.exec(rest);
    if (!m || !targetNames.includes(m[1])) return names;
    names.push(m[1]);
    rest = rest.slice(m[0].length);
  }
}

/** 先頭の宛先を names の並びに差し替える。本文はそのまま。names が空なら本文だけに戻す */
export function replaceLeadingAgentMentions(text: string, names: string[], targetNames: string[], assistantName: string | null | undefined): string {
  let rest = text;
  for (;;) {
    const m = /^@(\S+)\s*/.exec(rest);
    if (!m || !targetNames.includes(m[1])) break;
    rest = rest.slice(m[0].length);
  }
  return names.length ? `${orderAgentMentions(names, assistantName)} ${rest}` : rest;
}

/**
 * 送った文字の便の側から見て、自分の音声から「エージェントに送る」で作った便か (2026-10-24 小野さん判断)。
 * この便は引用の箱を出さず「🎤 音声から」を 1 行だけ出す (自分の音声を自分で引用し、同じ文が 2 回見えるため)。
 * 返信のつながりはデータとして残す (畳み込みの目印・AI が元の音声をたどれる)。条件は isSentToAgent と同じ
 */
export function isAgentSendFromOwnVoice(message: Message, assistantName: string | null | undefined): boolean {
  const q = message.reply_to_message;
  return !!q && q.type === 'voice' && q.sender_id === message.sender_id && startsWithAgentMention(message.content, assistantName);
}
