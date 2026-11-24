/**
 * 社内の画面を検索の巡回に載せない (2026-11-24 小野さん、改善ループ 103〜107 の承認 5)
 * ★ 11-23 に Google の巡回が部屋の URL (/rooms/<id>) を開いていた (ログインしていないので中身は見られていない)。
 *   robots.txt で巡回そのものを断り、それを守らない巡回には画面の印 (noindex) で「索引に載せない」を伝える
 */
import { describe, it, expect } from 'vitest';
// ★ client の型検査には node の型が無い (CI で落ちた) ので、ファイルは ?raw で読む
import robotsTxt from '../../public/robots.txt?raw';
import indexHtml from '../../index.html?raw';

describe('検索の巡回に載せない', () => {
  it('robots.txt が全体を断る (public に置くとビルドで dist の直下に出る)', () => {
    const txt = robotsTxt;
    expect(txt).toMatch(/^User-agent: \*$/m);
    expect(txt).toMatch(/^Disallow: \/$/m);
  });

  it('画面に noindex の印がある', () => {
    const html = indexHtml;
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
  });
});
