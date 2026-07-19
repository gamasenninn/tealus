/**
 * #338 Phase 1 — 「エージェントに送る」compose ヘルパーの prefill 文字列を組む純関数。
 *
 * 宛先メンションを **先頭** に置き（`isMentioned` の `^@<name>` に一致させる）、本文を
 * インラインで引き上げる。入口B は自分の投稿のみ（Q4）＝「自分のこの発言をアシスタントに
 * （再）送る」意味なので、text は content、voice は文字起こし（`content=null` のため）を本文に使う。
 * 本文が空でも末尾スペースを残し、カーソルがメンションの後ろに来るようにする。
 */
import type { Message } from '../types';

/** メッセージから「エージェントに渡す本文」を抽出（text=content / voice=文字起こし）。 */
export function extractAgentBody(message: Message): string {
  if (message.type === 'voice') {
    if (message.transcription?.status === 'done') {
      return message.transcription.formatted_text || message.transcription.raw_text || '';
    }
    return '';
  }
  return message.content || '';
}

export function buildAgentPrefill({ assistantName, message }: { assistantName: string; message: Message }): string {
  return `@${assistantName} ${extractAgentBody(message)}`;
}
