import { describe, it, expect } from 'vitest';
import { buildAgentPrefill } from '../src/utils/agentPrefill';
import type { Message } from '../src/types';

// #338 Phase 1: 「エージェントに送る」compose ヘルパーの prefill 文字列を組む純関数。
// 宛先メンションを先頭に置き、本文をインラインで引き上げる (text=content / voice=文字起こし)。

function msg(over: Partial<Message>): Message {
  return {
    id: 'm1', room_id: 'r1', sender_id: 'u1', content: null, type: 'text',
    created_at: '2026-07-19T00:00:00Z', ...over,
  } as Message;
}

describe('buildAgentPrefill', () => {
  it('テキスト: @<name> + content をインライン引き上げ', () => {
    const out = buildAgentPrefill({ assistantName: 'アシスタント', message: msg({ type: 'text', content: '在庫を教えて' }) });
    expect(out).toBe('@アシスタント 在庫を教えて');
  });

  it('音声(done): 文字起こし(formatted_text)を本文に引き上げ', () => {
    const out = buildAgentPrefill({
      assistantName: 'アシスタント',
      message: msg({ type: 'voice', content: null, transcription: { status: 'done', formatted_text: '明日の朝礼は9時', raw_text: 'あした あさ' } }),
    });
    expect(out).toBe('@アシスタント 明日の朝礼は9時');
  });

  it('音声(done): formatted_text 無しは raw_text で代替', () => {
    const out = buildAgentPrefill({
      assistantName: 'アシスタント',
      message: msg({ type: 'voice', content: null, transcription: { status: 'done', raw_text: 'なま テキスト' } }),
    });
    expect(out).toBe('@アシスタント なま テキスト');
  });

  it('音声(未完了): 本文なし → メンション + 末尾スペースのみ', () => {
    const out = buildAgentPrefill({
      assistantName: 'アシスタント',
      message: msg({ type: 'voice', content: null, transcription: { status: 'pending' } }),
    });
    expect(out).toBe('@アシスタント ');
  });

  it('本文が空 → メンション + 末尾スペースのみ (カーソルが後ろに来る)', () => {
    const out = buildAgentPrefill({ assistantName: 'アシスタント', message: msg({ type: 'text', content: '' }) });
    expect(out).toBe('@アシスタント ');
  });

  it('メンションは常に先頭 (isMentioned の ^@<name> に一致する形)', () => {
    const out = buildAgentPrefill({ assistantName: 'アシスタント', message: msg({ type: 'text', content: 'x' }) });
    expect(out.startsWith('@アシスタント')).toBe(true);
  });
});
