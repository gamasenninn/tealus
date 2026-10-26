/**
 * LINE の便を部屋の便にするとき、行頭の @ を全角にする (セキュリティチェックループの B、2026-10-26 小野さん判断)。
 * ★ LINE のグループの人 (Tealus の利用者でない) が @cc-〇〇 / 別名 / @アシスタント で班や AI を起こせていた
 */
import { applyContentLabel, neutralizeLineMentions } from '../../src/utils/lineContent.mts';

describe('neutralizeLineMentions', () => {
  it('★★ どの行でも、行頭の @ を ＠ にする (前の空白も見る)', () => {
    expect(neutralizeLineMentions('@cc-tealus 直して')).toBe('＠cc-tealus 直して');
    expect(neutralizeLineMentions('こんにちは\n@cc-support 見て\n  @アシスタント 要約')).toBe('こんにちは\n＠cc-support 見て\n  ＠アシスタント 要約');
    expect(neutralizeLineMentions('a\r\n@organon x')).toBe('a\r\n＠organon x');
  });
  it('★ 行の途中の @ (メールアドレスなど) は変えない', () => {
    expect(neutralizeLineMentions('連絡は ono@example.com まで @cc-x')).toBe('連絡は ono@example.com まで @cc-x');
  });
});

describe('applyContentLabel', () => {
  it('★★ ラベルがあってもなくても、本文の行頭の @ は ＠ になる', () => {
    expect(applyContentLabel('小野', '@cc-tealus 来て')).toBe('[小野]\n＠cc-tealus 来て');
    expect(applyContentLabel(null, '@アシスタント 要約して')).toBe('＠アシスタント 要約して');
  });
  it('今までどおり: ラベルだけ / 本文なし', () => {
    expect(applyContentLabel('小野', undefined)).toBe('[小野]');
    expect(applyContentLabel(null, undefined)).toBeUndefined();
    expect(applyContentLabel('小野', 'ふつうの文')).toBe('[小野]\nふつうの文');
  });
});
