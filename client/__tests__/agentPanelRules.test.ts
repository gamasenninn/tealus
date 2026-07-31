import { describe, it, expect } from 'vitest';
import {
  shouldOpenAgentPanel, shouldTriggerSlash, mergePromptInsertion, promptInsertionSelection,
  nextSlashAction,
} from '../src/utils/agentPanelRules';

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

/**
 * #358 挿入後にどこを選択するか。
 * 穴が無ければ null (末尾にカーソル = 従来どおり)。
 * 打てば置き換わり、打たなければ前回値のまま、が成立するように「選択範囲」を返す。
 */
describe('promptInsertionSelection', () => {
  const CONTENT = '@アシスタント 直近の画像4枚でDB投入して';
  // '@アシスタント 直近の画像' までが 12 文字 → '4' は [12,13)
  const HOLE = { start: CONTENT.indexOf('4'), end: CONTENT.indexOf('4') + 1 };

  it('入力欄が空なら穴の位置がそのまま選択範囲', () => {
    expect(promptInsertionSelection('', CONTENT, false, [HOLE])).toEqual(HOLE);
  });

  it('末尾に足したときは書きかけの長さ + 区切り分だけずれる', () => {
    const prev = '前置き';
    const sel = promptInsertionSelection(prev, CONTENT, false, [HOLE]);
    const merged = mergePromptInsertion(prev, CONTENT, false);
    expect(merged.slice(sel!.start, sel!.end)).toBe('4');
  });

  it('/ で開いたときは絞り込み文字列が捨てられるのでずれない', () => {
    expect(promptInsertionSelection('/画像', CONTENT, true, [HOLE])).toEqual(HOLE);
  });

  it('穴が無ければ null (末尾にカーソル)', () => {
    expect(promptInsertionSelection('', CONTENT, false, [])).toBeNull();
  });

  it('穴が複数あっても最初の1つを選ぶ (Tab 移動は Phase 2)', () => {
    const content = '@アシスタント 画像3枚と動画5本を処理して';
    const holes = [
      { start: content.indexOf('3'), end: content.indexOf('3') + 1 },
      { start: content.indexOf('5'), end: content.indexOf('5') + 1 },
    ];
    const sel = promptInsertionSelection('', content, false, holes);
    expect(content.slice(sel!.start, sel!.end)).toBe('3');
  });

  it('書きかけがあっても複数穴の最初を正しく指す', () => {
    const content = '@アシスタント 画像3枚と動画5本を処理して';
    const holes = [
      { start: content.indexOf('3'), end: content.indexOf('3') + 1 },
      { start: content.indexOf('5'), end: content.indexOf('5') + 1 },
    ];
    const prev = 'メモ';
    const sel = promptInsertionSelection(prev, content, false, holes);
    const merged = mergePromptInsertion(prev, content, false);
    expect(merged.slice(sel!.start, sel!.end)).toBe('3');
  });
});

/**
 * #346 候補2 (縮退版): textarea の onChange に JSX 内インラインで書かれていた
 * 順序依存の if / else if を、判断だけ純関数に出して固定する。
 *
 * ★ 分岐の順序そのものが仕様。slashMode を最優先で見ないと `/` の絞り込み中に
 *   compose を閉じる枝へ落ちてパネルが消える。
 */
describe('nextSlashAction', () => {
  const BASE = { isDesktop: true, assistantInRoom: true, panelMode: null as string | null };

  it('slash 絞り込み中は query を更新する', () => {
    expect(nextSlashAction({ ...BASE, slashMode: true, prevText: '/朝', nextText: '/朝礼' }))
      .toEqual({ kind: 'filter', query: '朝礼' });
  });

  it('★ slashMode は panelMode="compose" より優先される (絞り込み中にパネルを閉じない)', () => {
    expect(nextSlashAction({
      ...BASE, panelMode: 'compose', slashMode: true, prevText: '/朝', nextText: '/朝礼',
    })).toEqual({ kind: 'filter', query: '朝礼' });
  });

  it('slash 中に先頭の / が消えたら slash を抜けてパネルも閉じる', () => {
    expect(nextSlashAction({ ...BASE, slashMode: true, prevText: '/朝', nextText: '朝' }))
      .toEqual({ kind: 'exit-slash' });
  });

  it('ボタンで開いた compose は打ち始めたら閉じる', () => {
    expect(nextSlashAction({ ...BASE, panelMode: 'compose', slashMode: false, prevText: '', nextText: 'あ' }))
      .toEqual({ kind: 'close-panel' });
  });

  it('宛先待ちの target-only は打っても閉じない (pendingAgentBody を抱えている)', () => {
    expect(nextSlashAction({ ...BASE, panelMode: 'target-only', slashMode: false, prevText: '', nextText: 'あ' }))
      .toEqual({ kind: 'none' });
  });

  it('空欄に / を打ったら slash で開く', () => {
    expect(nextSlashAction({ ...BASE, slashMode: false, prevText: '', nextText: '/' }))
      .toEqual({ kind: 'open-slash', query: '' });
  });

  it('書きかけの途中の / では開かない (docs/05 等のパス誤爆を避ける)', () => {
    expect(nextSlashAction({ ...BASE, slashMode: false, prevText: 'docs', nextText: 'docs/' }))
      .toEqual({ kind: 'none' });
  });

  it('スマホでは / で開かない', () => {
    expect(nextSlashAction({ ...BASE, isDesktop: false, slashMode: false, prevText: '', nextText: '/' }))
      .toEqual({ kind: 'none' });
  });

  it('アシスタント不在ルームでは / で開かない', () => {
    expect(nextSlashAction({ ...BASE, assistantInRoom: false, slashMode: false, prevText: '', nextText: '/' }))
      .toEqual({ kind: 'none' });
  });

  it('通常の入力は何もしない', () => {
    expect(nextSlashAction({ ...BASE, slashMode: false, prevText: 'おはよ', nextText: 'おはよう' }))
      .toEqual({ kind: 'none' });
  });
});
