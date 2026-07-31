import { describe, it, expect } from 'vitest';
import { detectMentionQuery, insertMentionAtCursor } from '../src/utils/mentionInput';

/**
 * #346 候補2 (縮退版): MessageInput の onChange / MentionPicker onSelect に
 * インラインで書かれていた検知・挿入を純関数として固定する。
 *
 * ★ 挿入結果の先頭形式は agent-server の isMentioned (`^@<name>` / 先行空白のみ許容、
 *   agent-server/src/webhook/mention.mts) が読む契約。ここが崩れると mention しても
 *   エージェントが起動しない (画面上は正常に見えるので気づけない) ため文字列で固定する。
 */
describe('detectMentionQuery', () => {
  it('カーソル直前の @ に続く文字列を query として返す', () => {
    expect(detectMentionQuery('@田中', 3)).toBe('田中');
  });

  it('素の @ は空 query を返す (候補を全件出す)', () => {
    expect(detectMentionQuery('@', 1)).toBe('');
  });

  it('@ の後に空白が来たら検知を終える', () => {
    expect(detectMentionQuery('@田中 ', 4)).toBeNull();
  });

  it('@ が無ければ null', () => {
    expect(detectMentionQuery('おはよう', 4)).toBeNull();
  });

  it('カーソルより後ろの @ は見ない', () => {
    expect(detectMentionQuery('あ@田中', 1)).toBeNull();
  });

  it('直近の @ を採る (@ が連続しても後ろ側)', () => {
    expect(detectMentionQuery('@あ@い', 4)).toBe('い');
  });

  it('文中の @ でも検知する (先頭限定ではない)', () => {
    expect(detectMentionQuery('これは @田', 6)).toBe('田');
  });
});

describe('insertMentionAtCursor', () => {
  it('打ちかけの @ を宛先で置き換え、末尾に空白を足す', () => {
    expect(insertMentionAtCursor('@田', 2, '田中太郎')).toEqual({
      text: '@田中太郎 ',
      cursor: 6,
    });
  });

  it('★ 先頭挿入は agent-server の ^@<name> 契約を満たす', () => {
    const r = insertMentionAtCursor('@', 1, 'cc-organon');
    expect(r?.text.startsWith('@cc-organon')).toBe(true);
  });

  it('カーソル以降のテキストを保持する', () => {
    expect(insertMentionAtCursor('@田 おはよう', 2, '田中太郎')).toEqual({
      text: '@田中太郎  おはよう',
      cursor: 6,
    });
  });

  it('文中に挿入しても前後を壊さない', () => {
    expect(insertMentionAtCursor('これは @た です', 6, '田中太郎')).toEqual({
      text: 'これは @田中太郎  です',
      cursor: 10,
    });
  });

  it('カーソルは挿入した宛先の直後 (@ + 名前 + 空白)', () => {
    const r = insertMentionAtCursor('@a', 2, 'bob');
    expect(r?.text.slice(0, r.cursor)).toBe('@bob ');
  });

  it('@ が無ければ null (呼び手は何もしない)', () => {
    expect(insertMentionAtCursor('おはよう', 4, '田中太郎')).toBeNull();
  });
});
