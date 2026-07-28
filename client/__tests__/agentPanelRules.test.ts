import { describe, it, expect } from 'vitest';
import { shouldOpenAgentPanel, shouldTriggerSlash, mergePromptInsertion } from '../src/utils/agentPanelRules';

/**
 * #354 🤖 パネルを「開くか / 直挿入か」「`/` で開くか」「どう差し込むか」の判断規則。
 * MessageInput の配線から切り離して固定する。
 */

describe('shouldOpenAgentPanel', () => {
  it('履歴が1件でもあれば開く', () => {
    expect(shouldOpenAgentPanel({ historyCount: 1, targetCount: 1 })).toBe(true);
  });

  it('宛先が複数あれば履歴0件でも開く (選ばせる必要があるため)', () => {
    expect(shouldOpenAgentPanel({ historyCount: 0, targetCount: 3 })).toBe(true);
  });

  it('履歴0件で宛先が1つなら開かない — 従来どおり1タップで即挿入', () => {
    expect(shouldOpenAgentPanel({ historyCount: 0, targetCount: 1 })).toBe(false);
  });

  it('宛先が0でも開かない', () => {
    expect(shouldOpenAgentPanel({ historyCount: 0, targetCount: 0 })).toBe(false);
  });
});

describe('shouldTriggerSlash', () => {
  const base = { prevText: '', nextText: '/', isDesktop: true, assistantInRoom: true };

  it('空の入力欄で / を打ったら開く', () => {
    expect(shouldTriggerSlash(base)).toBe(true);
  });

  it('空の入力欄に /朝礼 を貼り付けても開く', () => {
    expect(shouldTriggerSlash({ ...base, nextText: '/朝礼' })).toBe(true);
  });

  it('入力途中の / では開かない — パスを打つときの誤爆を避ける', () => {
    expect(shouldTriggerSlash({ ...base, prevText: 'docs', nextText: 'docs/' })).toBe(false);
    expect(shouldTriggerSlash({ ...base, prevText: 'src', nextText: 'src/app.mts' })).toBe(false);
  });

  it('先頭が / でなければ開かない', () => {
    expect(shouldTriggerSlash({ ...base, nextText: 'こんにちは' })).toBe(false);
  });

  it('スマホでは開かない — 日本語IMEで記号が打ちにくく全角「／」も混ざる', () => {
    expect(shouldTriggerSlash({ ...base, isDesktop: false })).toBe(false);
  });

  it('アシスタントが不在のルームでは開かない', () => {
    expect(shouldTriggerSlash({ ...base, assistantInRoom: false })).toBe(false);
  });
});

describe('mergePromptInsertion', () => {
  const CONTENT = '@アシスタント 直近24hをまとめて';

  it('入力欄が空なら置き換える', () => {
    expect(mergePromptInsertion('', CONTENT, false)).toBe(CONTENT);
  });

  it('書きかけがあれば末尾に足す', () => {
    expect(mergePromptInsertion('前置き', CONTENT, false)).toBe(`前置き ${CONTENT}`);
  });

  it('末尾の空白を重ねない', () => {
    expect(mergePromptInsertion('前置き   ', CONTENT, false)).toBe(`前置き ${CONTENT}`);
  });

  it('/ で開いたときは絞り込み文字列ごと置き換える', () => {
    expect(mergePromptInsertion('/24h', CONTENT, true)).toBe(CONTENT);
  });

  it('空白だけの入力欄は空とみなす', () => {
    expect(mergePromptInsertion('   ', CONTENT, false)).toBe(CONTENT);
  });
});
