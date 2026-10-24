/**
 * agent-server の OpenAI クライアントには、こちらで決めた時間切れを付ける (改善ループ 14 回目、2026-10-24)
 *
 * ★ 本体側 (文字起こし・整形) は 10-23 に 2 分・やり直し 1 回にしたが、agent-server の振り分け (Router) と Light v1 は
 *   SDK の既定 (10 分 × やり直し 2 回 = 最長 30 分) のままだった。相手が固まると @アシスタント の返事が 30 分来ない
 * ★ 作る所ごとにテストを書くと取り残すので、src の `new OpenAI(` を全部見る
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../../src');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (p.endsWith('.mts')) out.push(p);
  }
  return out;
}

test('src の new OpenAI({...}) はすべて timeout と maxRetries を持つ', () => {
  const offenders: string[] = [];
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/new OpenAI\(\{([^}]*)\}\)/g)) {
      if (!/timeout\s*:/.test(m[1]) || !/maxRetries\s*:/.test(m[1])) offenders.push(`${path.relative(SRC, f)}: ${m[0]}`);
    }
  }
  expect(offenders).toEqual([]);
});
