/**
 * #510 リンクプレビューの URL 切り出しが、後ろに続く日本語の括弧・句点まで含めていた
 *
 * 以前は「空白が来るまで」を全部 URL にしていた。本番の link_previews 402 件中 6 件で
 * `https://youtu.be/xxxx（限定公開）` `…）。` のように混ざり、`https://…` には取りに行って失敗していた。
 */
jest.mock('../../src/utils/logger.mts', () => ({ logger: {
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
} }));

import { extractUrls } from '../../src/services/linkPreview.mts';

describe('extractUrls (#510)', () => {
  it.each([
    ['動画です https://youtu.be/abc_DEF-123（限定公開）', 'https://youtu.be/abc_DEF-123'],
    ['こちら（https://youtu.be/abc）。', 'https://youtu.be/abc'],
    ['https://example.com/a、https://example.com/b', 'https://example.com/a'],
    ['「https://example.com/x」を見て', 'https://example.com/x'],
    ['見て https://example.com/p！', 'https://example.com/p'],
    ['https://example.com/p…続き', 'https://example.com/p'],
  ])('★ 後ろの日本語の記号を含めない: %s', (text, want) => {
    expect(extractUrls(text)[0]).toBe(want);
  });

  it('★ 対になっていない閉じ括弧と、文末のピリオドは削る', () => {
    expect(extractUrls('(see https://github.com/o/r/issues/1#issuecomment-5)）。issue')[0])
      .toBe('https://github.com/o/r/issues/1#issuecomment-5');
    expect(extractUrls('Read https://example.com/doc.')[0]).toBe('https://example.com/doc');
  });

  it('★ 対になっている括弧は残す (Wikipedia など)', () => {
    expect(extractUrls('https://en.wikipedia.org/wiki/Foo_(bar) を参照')[0])
      .toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('★ URL の直後に続く日本語は含めない (間に空白が無い書き方は多い)', () => {
    expect(extractUrls('https://example.com/pathを見て')[0]).toBe('https://example.com/path');
  });

  it('★★ Markdown のリンク (AI の返信に多い) は括弧の中だけ', () => {
    expect(extractUrls('天気は[こちら](https://tenki.jp/forecast/9205.html)で確認できます。')[0])
      .toBe('https://tenki.jp/forecast/9205.html');
    expect(extractUrls('([会社](https://www.example.co.jp/corporate?utm_source=openai))')[0])
      .toBe('https://www.example.co.jp/corporate?utm_source=openai');
  });

  it('バッククォートで囲んだ URL', () => {
    expect(extractUrls('`http://127.0.0.1:8000` を開く')[0]).toBe('http://127.0.0.1:8000');
  });

  it('★ 日本語を含む URL は変換された形 (%E6...) で通る (生の日本語は途中で切れる。割り切り)', () => {
    expect(extractUrls('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC です')[0])
      .toBe('https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC');
  });

  it('クエリ・断片はそのまま', () => {
    expect(extractUrls('https://example.com/s?q=a&b=1#top')[0]).toBe('https://example.com/s?q=a&b=1#top');
  });

  it('★ 読めない URL (省略表記の https://…) は返さない', () => {
    expect(extractUrls('リンクは https://… にあります')).toEqual([]);
  });

  it('無ければ空', () => {
    expect(extractUrls('URL なし')).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
  });
});
