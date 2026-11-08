/**
 * CSS の変数は、代わりの値なしで使うなら定義されていること (改善ループ 42)
 *
 * ★ 吹き出しの Markdown の表の罫線と hr は var(--border) を使っていたが、--border はどこにも定義が無く
 *   (定義は --border-light / --border-medium / --border-dark)、罫線も区切り線も描かれていなかった。
 *   未定義の変数は黙って無効になるので、画面を見ないと気づけない
 * ★ CSS は vitest では空の文字として渡る (import.meta.glob の ?raw も) ので、ファイルを直接読む。
 *   画面の型検査は Node の型を持たないので、型は手で付ける (srcFiles.ts)
 */
import { describe, it, expect } from 'vitest';
import { readSrcFiles } from './helpers/srcFiles';

/** JS で入れる変数 (useVisualViewportVars) */
const SET_BY_SCRIPT = new Set(['--vvh', '--vvt']);

describe('CSS の変数', () => {
  it('★ 代わりの値なしの var(--x) は、どこかで定義されている', () => {
    const all = readSrcFiles(/\.(css|tsx?)$/);
    expect(all.filter((f) => f.path.endsWith('.css')).length).toBeGreaterThan(20);   // ★ 空振りしていないこと
    expect(all.find((f) => f.path.endsWith('index.css'))?.text).toContain('--primary:');
    const defined = new Set(all.flatMap(({ text }) => [...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
    const missing = all.flatMap(({ path, text }) =>
      [...text.matchAll(/var\((--[\w-]+)\s*\)/g)]
        .map((m) => m[1])
        .filter((v) => !defined.has(v) && !SET_BY_SCRIPT.has(v))
        .map((v) => `${path}: ${v}`));
    expect(missing).toEqual([]);
  });
});
