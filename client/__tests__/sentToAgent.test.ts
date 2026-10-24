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

// ★ 2026-10-24 小野さん判断 (案 C): 「決定」をなくし、押した宛先がその場で入力欄の先頭に入る。もう一度押すと消える
import { leadingAgentMentions, replaceLeadingAgentMentions } from '../src/utils/sentToAgent';
const TARGETS = ['アシスタント', 'cc-tealus', 'cc-hks-portal'];
describe('leadingAgentMentions', () => {
  it('先頭に並んだ宛先だけを拾う (宛先でない @ や本文の途中の @ は拾わない)', () => {
    expect(leadingAgentMentions('@cc-tealus @cc-hks-portal 調べて @cc-organon', TARGETS)).toEqual(['cc-tealus', 'cc-hks-portal']);
    expect(leadingAgentMentions('@田中 @cc-tealus 調べて', TARGETS)).toEqual([]);
    expect(leadingAgentMentions('調べて', TARGETS)).toEqual([]);
  });
});
describe('replaceLeadingAgentMentions', () => {
  it('★ 先頭の宛先を選び直した並びに差し替え、本文はそのまま残す', () => {
    expect(replaceLeadingAgentMentions('@cc-tealus 調べて', ['cc-tealus', 'cc-hks-portal'], TARGETS, 'アシスタント'))
      .toBe('@cc-tealus @cc-hks-portal 調べて');
  });
  it('★ 全部外すと本文だけに戻る', () => {
    expect(replaceLeadingAgentMentions('@cc-tealus 調べて', [], TARGETS, 'アシスタント')).toBe('調べて');
  });
  it('本文だけのところに宛先を足す。@アシスタント は先頭', () => {
    expect(replaceLeadingAgentMentions('調べて', ['cc-tealus', 'アシスタント'], TARGETS, 'アシスタント'))
      .toBe('@アシスタント @cc-tealus 調べて');
  });
});

// ★ 2026-10-24 小野さん判断: 自分の音声への「エージェントに送る」は、引用の箱を出さず「🎤 音声から」を 1 行だけ出す
import { isAgentSendFromOwnVoice } from '../src/utils/sentToAgent';
describe('isAgentSendFromOwnVoice (送った文字の便の側から見る)', () => {
  const base = { id: 't1', sender_id: 'me', type: 'text', content: '@cc-tealus 調べて',
    reply_to_message: { id: 'v1', type: 'voice', sender_id: 'me', content: '調べて', sender_display_name: '私' } } as unknown as Message;
  it('★ 自分の音声への返信で、先頭が宛先なら true', () => {
    expect(isAgentSendFromOwnVoice(base, 'アシスタント')).toBe(true);
  });
  it('人の音声・文字への返信・宛先の無い返信は false (今までどおり引用の箱)', () => {
    expect(isAgentSendFromOwnVoice({ ...base, reply_to_message: { ...base.reply_to_message!, sender_id: 'other' } } as Message, 'アシスタント')).toBe(false);
    expect(isAgentSendFromOwnVoice({ ...base, reply_to_message: { ...base.reply_to_message!, type: 'text' } } as Message, 'アシスタント')).toBe(false);
    expect(isAgentSendFromOwnVoice({ ...base, content: '了解です' } as Message, 'アシスタント')).toBe(false);
  });
});
