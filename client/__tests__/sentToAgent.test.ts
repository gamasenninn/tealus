import { describe, it, expect } from 'vitest';
import { isSentToAgent, orderAgentMentions } from '../src/utils/sentToAgent';
import type { Message } from '../src/types';

/**
 * 2026-10-24 小野さん判断: 音声を「エージェントに送る」で送ったら、元の音声の文字起こしは畳む
 * (同じ文が 2 回並ぶ違和感を消す)。見分けは読み込んだ便から決める (DB は変えない)
 */
const voice = { id: 'v1', sender_id: 'me', type: 'voice', is_deleted: false } as unknown as Message;
const reply = (over: Partial<Message> & { content: string }) =>
  ({ id: 'r1', sender_id: 'me', type: 'text', reply_to: 'v1', is_deleted: false, ...over }) as unknown as Message;

describe('isSentToAgent', () => {
  it('★ 同じ人がその音声に返信し、先頭が @アシスタント なら畳む', () => {
    expect(isSentToAgent(voice, [voice, reply({ content: '@アシスタント 調べて' })], 'アシスタント')).toBe(true);
  });
  it('先頭が @cc-〇〇 でも畳む (複数並んでいても)', () => {
    expect(isSentToAgent(voice, [voice, reply({ content: '@cc-tealus @cc-hks-portal 調べて' })], 'アシスタント')).toBe(true);
  });
  it('ほかの人の返信・人への返信・消した返信では畳まない', () => {
    expect(isSentToAgent(voice, [voice, reply({ content: '@cc-tealus x', sender_id: 'other' })], 'アシスタント')).toBe(false);
    expect(isSentToAgent(voice, [voice, reply({ content: '@田中 見ておいて' })], 'アシスタント')).toBe(false);
    expect(isSentToAgent(voice, [voice, reply({ content: '@cc-tealus x', is_deleted: true })], 'アシスタント')).toBe(false);
  });
  it('音声でなければ畳まない', () => {
    const text = { ...voice, type: 'text' } as Message;
    expect(isSentToAgent(text, [text, reply({ content: '@cc-tealus x' })], 'アシスタント')).toBe(false);
  });
});

describe('orderAgentMentions', () => {
  it('★ @アシスタント は先頭でないと応答しないので、選んだ中にあれば先頭に置く。ほかは選んだ順', () => {
    expect(orderAgentMentions(['cc-tealus', 'アシスタント', 'cc-organon'], 'アシスタント'))
      .toBe('@アシスタント @cc-tealus @cc-organon');
  });
  it('班だけなら選んだ順', () => {
    expect(orderAgentMentions(['cc-organon', 'cc-tealus'], 'アシスタント')).toBe('@cc-organon @cc-tealus');
  });
});
