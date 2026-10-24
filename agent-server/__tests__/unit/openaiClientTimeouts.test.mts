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

/** `new OpenAI(` から対応する `)` までを取り出す (★ 引数に入れ子の {} があっても途中で切らない、改善ループ 15 回目) */
function callsOf(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf('new OpenAI(');
  while (i >= 0) {
    let depth = 0;
    let j = i + 'new OpenAI'.length;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf('new OpenAI(', j);
  }
  return out;
}

test('src の new OpenAI(...) はすべて timeout と maxRetries を持つ', () => {
  const offenders: string[] = [];
  for (const f of walk(SRC)) {
    for (const call of callsOf(fs.readFileSync(f, 'utf8'))) {
      if (!/timeout\s*:/.test(call) || !/maxRetries\s*:/.test(call)) offenders.push(`${path.relative(SRC, f)}: ${call}`);
    }
  }
  expect(offenders).toEqual([]);
});

// ★ 改善ループ 15 回目: Light v1 のモデル呼び出しは Agents SDK の run() で、SDK は自分の既定クライアントを使う。
//   light.mts で作った時間切れつきの openai は、渡さないと効かない (10-24 に付けた 2 分が効いていなかった)
test('Light v1 は時間切れつきのクライアントを Agents SDK の既定にする', () => {
  const src = fs.readFileSync(path.join(SRC, 'agents', 'light.mts'), 'utf8');
  expect(src).toMatch(/setDefaultOpenAIClient\(openai[ )]/);
});
