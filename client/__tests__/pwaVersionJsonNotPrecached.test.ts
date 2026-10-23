/**
 * version.json を SW の precache に入れない (docs/05、2026-10-23 改善ループ 11 回目)
 *
 * ★ 更新の検知は version.json を取り直して版を比べる。precache に入ると SW が古い版を返し続け、
 *   **更新の検知そのものが黙って死ぬ**。以前はこれを守るテストが無かった (設定の 1 行を消しても CI は緑)
 * ★ 設定ファイルは文字として読む (client の型検査は Node の型を持たないので node:fs は使わない)
 */
import { describe, test, expect } from 'vitest';
// vite.config.js を文字として読む (Vite の ?raw。型は vite/client が持つ)
import viteConfigSource from '../vite.config.js?raw';

describe('version.json は precache しない', () => {
  test('workbox の globIgnores に **/version.json がある', () => {
    const src = viteConfigSource as string;
    const m = src.match(/globIgnores\s*:\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/['"]\*\*\/version\.json['"]/);
  });
});
