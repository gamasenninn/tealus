/**
 * #561 外部コマンドは引数の配列で呼ぶ (execFile / spawn)。コマンドを 1 本の文字列に組み立てて実行しない。
 * ★ 以前は文字起こしの ffmpeg 呼び出し 2 か所が文字列だった (サムネイルは配列だった)
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

test('server/src は child_process の exec / execSync を使わない', () => {
  const offenders = walk(SRC).filter((f) => /\b(execSync|exec)\b[^\n]*from 'node:child_process'|import\s*\{[^}]*\b(execSync|exec)\b[^}]*\}\s*from\s*'(node:)?child_process'/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f));
  expect(offenders).toEqual([]);
});
