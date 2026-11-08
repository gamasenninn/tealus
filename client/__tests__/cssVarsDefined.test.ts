/**
 * CSS の変数は、代わりの値なしで使うなら定義されていること (改善ループ 42)
 *
 * ★ 吹き出しの Markdown の表の罫線と hr は var(--border) を使っていたが、--border はどこにも定義が無く
 *   (定義は --border-light / --border-medium / --border-dark)、罫線も区切り線も描かれていなかった。
 *   未定義の変数は黙って無効になるので、画面を見ないと気づけない
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../src');
/** JS で入れる変数 (useVisualViewportVars) */
const SET_BY_SCRIPT = new Set(['--vvh', '--vvt']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(css|tsx?)$/.test(n) ? [p] : [];
  });
}

describe('CSS の変数', () => {
  it('★ 代わりの値なしの var(--x) は、どこかで定義されている', () => {
    const all = files(SRC).map((p) => ({ p, s: readFileSync(p, 'utf8') }));
    const defined = new Set(all.flatMap(({ s }) => [...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
    const missing = all.flatMap(({ p, s }) =>
      [...s.matchAll(/var\((--[\w-]+)\s*\)/g)]
        .map((m) => m[1])
        .filter((v) => !defined.has(v) && !SET_BY_SCRIPT.has(v))
        .map((v) => `${p.slice(SRC.length + 1)}: ${v}`));
    expect(missing).toEqual([]);
  });
});
