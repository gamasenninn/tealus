/**
 * bot の検索 (GET /api/bot/search) の抜粋づくりと LIKE の逃がし。改善ループ 120 で bot.mts から出した
 * ★ 結合テスト (bot-api.test) は検索の結果として通している。ここは枝ごとに固定する
 */
import { buildSnippet, escapeLike } from '../../src/services/searchSnippet.mts';

describe('buildSnippet', () => {
  it('本文が無ければ「(メディアのみ)」', () => {
    expect(buildSnippet(null, 'x')).toBe('(メディアのみ)');
    expect(buildSnippet('', 'x')).toBe('(メディアのみ)');
  });

  it('語が無ければ先頭 200 字 (超えたら ...)', () => {
    expect(buildSnippet('短い', undefined)).toBe('短い');
    expect(buildSnippet('あ'.repeat(201), undefined)).toBe('あ'.repeat(200) + '...');
    expect(buildSnippet('あ'.repeat(200), undefined)).toBe('あ'.repeat(200));
  });

  it('語が見つからなければ、語が無いときと同じ', () => {
    expect(buildSnippet('あ'.repeat(201), 'ん')).toBe('あ'.repeat(200) + '...');
  });

  it('見つかった語を ** で囲み、前後 100 字。切ったほうに ...', () => {
    const text = 'a'.repeat(150) + 'KEY' + 'b'.repeat(150);
    expect(buildSnippet(text, 'KEY')).toBe('...' + 'a'.repeat(100) + '**KEY**' + 'b'.repeat(100) + '...');
  });

  it('端に近ければ ... を付けない', () => {
    expect(buildSnippet('前KEY後', 'KEY')).toBe('前**KEY**後');
  });

  it('大文字小文字は区別せずに探し、本文の綴りのまま囲む', () => {
    expect(buildSnippet('hello World', 'world')).toBe('hello **World**');
  });

  it('前後の幅は引数で変えられる', () => {
    expect(buildSnippet('12345KEY67890', 'KEY', 2)).toBe('...45**KEY**67...');
  });
});

describe('escapeLike', () => {
  // ★ 期待値は String.raw で書く (\ の数を目で数えられるように)
  it('\\ と % と _ を逃がす (\\ を先に)', () => {
    expect(escapeLike('50%')).toBe(String.raw`50\%`);
    expect(escapeLike('a_b')).toBe(String.raw`a\_b`);
    expect(escapeLike(String.raw`c:\x`)).toBe(String.raw`c:\\x`);
    expect(escapeLike(String.raw`\%`)).toBe(String.raw`\\\%`);
  });

  it('普通の文字はそのまま', () => {
    expect(escapeLike('トラクター')).toBe('トラクター');
  });
});
