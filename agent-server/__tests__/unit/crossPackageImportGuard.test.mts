/**
 * agent-server が server/ から import しているファイルは、**外部パッケージを読んではいけない**
 * (2026-09-24)。
 *
 * ★★★★★ **なぜ要るか (実際に踏んだ)**:
 *   2026-09-24 に `confirmMarks.mts` が `server/scripts/organonDictProjection.mts` を import した。
 *   あちらは `n3` を読む。★ agent-server の package.json にも `n3` は在る。**それでも CI は落ちた。**
 *   ★★ bare specifier は **import 元のファイル位置**から解決されるので、
 *      `server/scripts/…` は `server/node_modules` を探す。★★★ agent-server ジョブでは
 *      server の依存が入っていないので `TS2307: Cannot find module 'n3'`。
 *   ★★★★ **手元では `server/node_modules` が見えるので通ってしまう** = 手元では捕まらない。
 *      実際に 5 回 push して 5 回とも赤にした。
 *
 * ★ 規則: agent-server から辿れる server 配下のファイルは
 *   **相対 import と `node:` 組み込みだけ**で閉じていること。
 */
import fs from 'node:fs';
import path from 'node:path';

const AGENT_SRC = path.resolve(import.meta.dirname, '../../src');
const REPO = path.resolve(import.meta.dirname, '../../..');

/** ★ `.mts` / `.ts` を集める */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.m?ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** ★ import / export ... from '…' の指定子を取る */
function specifiersOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}

const isRelative = (s: string) => s.startsWith('./') || s.startsWith('../');
const isBuiltin = (s: string) => s.startsWith('node:');

describe('agent-server → server の import は依存ゼロの file だけを辿る', () => {
  it('★★★★★ 辿れる server 配下の file が外部パッケージを読んでいない', () => {
    // ★ 入口: agent-server から server/ を指している import
    const entries = new Set<string>();
    for (const f of walk(AGENT_SRC)) {
      for (const s of specifiersOf(f)) {
        if (!isRelative(s)) continue;
        const abs = path.resolve(path.dirname(f), s);
        if (abs.startsWith(path.join(REPO, 'server') + path.sep)) entries.add(abs);
      }
    }
    expect(entries.size).toBeGreaterThan(0);   // ★ 0 なら この test が空振りしている

    // ★★ そこから相対 import を辿り、bare specifier を集める
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [...entries];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f) || !fs.existsSync(f)) continue;
      seen.add(f);
      for (const s of specifiersOf(f)) {
        if (isBuiltin(s)) continue;
        if (isRelative(s)) { queue.push(path.resolve(path.dirname(f), s)); continue; }
        offenders.push(`${path.relative(REPO, f)} → '${s}'`);
      }
    }
    // ★★★ 落ちたときに **どの file の どの import か**がそのまま読めるように出す
    expect(offenders).toEqual([]);
  });
});
