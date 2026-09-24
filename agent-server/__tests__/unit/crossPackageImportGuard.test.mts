/**
 * パッケージを跨ぐ相対 import は、**跨いだ先が外部パッケージを読まない**こと (2026-09-24)。
 *
 * ★★★★★ **なぜ要るか (実際に踏んだ)**:
 *   2026-09-24 に `agent-server/src/lib/confirmMarks.mts` が
 *   `server/scripts/organonDictProjection.mts` を import した。あちらは `n3` を読む。
 *   ★ `n3` は agent-server の package.json にも在る。**それでも CI は落ちた。**
 *   ★★ bare specifier は **import 元のファイル位置**から解決されるので、
 *      `server/scripts/…` は `server/node_modules` を探す。★★★ CI は各ジョブで
 *      **自分のパッケージの依存しか入れない** (`npm ci` をその working-directory で走らせる)。
 *   ★★★★ **手元では全部の node_modules が在るので通ってしまう** = 手元では捕まらない。
 *      5 回 push して 5 回とも赤にした (5 時間)。
 *
 * ★ 規則: 跨いだ先から相対でだけ辿れる範囲が、**`node:` 組み込みだけ**で閉じていること。
 * ★★ 例外は `ALLOWED` に **理由つきで**書く (★★★ CI 側で相手の依存も入れている組だけ)。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const PKGS = ['server', 'client', 'dashboard', 'agent-server', 'rtc-server']
  .filter((p) => fs.existsSync(path.join(REPO, p, 'package.json')));

/**
 * ★ 例外。★★ **CI で相手の依存も install している組だけ**が入れる。
 *   入れるときは `.github/workflows/test.yml` の該当 step を一緒に直すこと。
 */
const ALLOWED = new Map<string, string>([
  // .github/workflows/test.yml: rtc-server-typecheck が
  //   「Install agent-server dependencies (rtc-server が横断 import)」を持っている
  ['rtc-server → agent-server', 'test.yml の rtc-server-typecheck が agent-server の依存も install する'],
]);

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', 'logs', 'public', 'tts_samples']);
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?ts|m?js|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
function specifiersOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return out;
}
const isRelative = (s: string) => s.startsWith('./') || s.startsWith('../');
const isBuiltin = (s: string) => s.startsWith('node:');
const pkgOf = (abs: string): string | null =>
  PKGS.find((p) => abs.startsWith(path.join(REPO, p) + path.sep)) ?? null;

describe('パッケージを跨ぐ import は依存ゼロの file だけを辿る', () => {
  it('★★★★★ 跨いだ先から外部パッケージへ辿れない (例外は ALLOWED に理由つき)', () => {
    // ★ 入口を集める。★★ **`src/` だけを歩かない** —— 最初の版はそうして
    //   `rtc-server/tts-speak.mts` (package 直下) をまるごと見落とした。
    const entries: { pair: string; from: string; target: string }[] = [];
    for (const pkg of PKGS) {
      for (const f of walk(path.join(REPO, pkg))) {
        for (const s of specifiersOf(f)) {
          if (!isRelative(s)) continue;
          const abs = path.resolve(path.dirname(f), s);
          const to = pkgOf(abs);
          if (to && to !== pkg) entries.push({ pair: `${pkg} → ${to}`, from: path.relative(REPO, f), target: abs });
        }
      }
    }
    expect(entries.length).toBeGreaterThan(0);   // ★ 0 なら この test が空振りしている

    const offenders: string[] = [];
    for (const e of entries) {
      if (ALLOWED.has(e.pair)) continue;
      const seen = new Set<string>();
      const queue = [e.target];
      while (queue.length) {
        const f = queue.pop()!;
        if (seen.has(f) || !fs.existsSync(f)) continue;
        seen.add(f);
        for (const s of specifiersOf(f)) {
          if (isBuiltin(s)) continue;
          if (isRelative(s)) { queue.push(path.resolve(path.dirname(f), s)); continue; }
          offenders.push(`${e.pair}: ${e.from} → ${path.relative(REPO, f)} → '${s}'`);
        }
      }
    }
    // ★★★ 落ちたときに **どの跨ぎの どの file の どの import か**がそのまま読めるように出す
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('★ ALLOWED に書いた組が、実際に跨いでいる (★★ 使われない例外を残さない)', () => {
    const pairs = new Set<string>();
    for (const pkg of PKGS) {
      for (const f of walk(path.join(REPO, pkg))) {
        for (const s of specifiersOf(f)) {
          if (!isRelative(s)) continue;
          const to = pkgOf(path.resolve(path.dirname(f), s));
          if (to && to !== pkg) pairs.add(`${pkg} → ${to}`);
        }
      }
    }
    for (const k of ALLOWED.keys()) expect(pairs.has(k)).toBe(true);
  });
});
