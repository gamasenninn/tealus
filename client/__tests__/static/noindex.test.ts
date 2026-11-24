/**
 * 社内の画面を検索の巡回に載せない (2026-11-24 小野さん、改善ループ 103〜107 の承認 5)
 * ★ 11-23 に Google の巡回が部屋の URL (/rooms/<id>) を開いていた (ログインしていないので中身は見られていない)。
 *   robots.txt で巡回そのものを断り、それを守らない巡回には画面の印 (noindex) で「索引に載せない」を伝える
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(__dirname, '../..');

describe('検索の巡回に載せない', () => {
  it('robots.txt が全体を断る (public に置くとビルドで dist の直下に出る)', () => {
    const txt = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');
    expect(txt).toMatch(/^User-agent: \*$/m);
    expect(txt).toMatch(/^Disallow: \/$/m);
  });

  it('画面に noindex の印がある', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
  });
});
