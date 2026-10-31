/**
 * Markdown の部品 (改善ループ 31)
 * ★ 古い Safari (16.4 より前) は正規表現の後読み (?<=…) を持たない。remark-gfm のメールの自動リンクが
 *   描画のたびに後読みの正規表現を作るので、ホーム画面ごと「画面の表示で問題が起きました」になっていた
 *   (10-29・10-30 に Safari 15.4 から 6 回)。後読みを持たない環境では remark-gfm を外す
 */
import { describe, it, expect } from 'vitest';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { markdownPlugins, supportsLookbehind } from '../src/utils/markdownPlugins';

describe('markdownPlugins', () => {
  it('★★ 後読みが使える環境では remark-gfm と remark-breaks', () => {
    expect(markdownPlugins(true)).toEqual([remarkGfm, remarkBreaks]);
  });
  it('★★ 後読みが使えない環境では remark-gfm を外す (改行は残す)', () => {
    expect(markdownPlugins(false)).toEqual([remarkBreaks]);
  });
  it('この試験の環境 (Node) は後読みを持つ', () => {
    expect(supportsLookbehind()).toBe(true);
  });
});
