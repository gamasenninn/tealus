/**
 * #555 agent-server の Docker イメージには、起動時に読む agent-server の外のファイルも入っていること。
 *
 * ★ なぜ要るか (2026-10-10 に実際にイメージを作って確かめた):
 *   agent-server は server/src/services/ の 2 ファイルを相対 import している。Dockerfile は agent-server/ しか
 *   コピーしておらず、イメージの中で ERR_MODULE_NOT_FOUND = docker-compose.full.yml の agent-server が起動しなかった。
 *   ★★ CI は docker build をしないので、ここで「入口から辿れる外のファイル」と「Dockerfile の COPY」を突き合わせる
 * ★ 辿るのは src/index.mts から届く相対 import (静的 + 文字列の動的 import)
 */
import fs from 'node:fs';
import path from 'node:path';

const AGENT = path.resolve(import.meta.dirname, '../..');
const REPO = path.resolve(AGENT, '..');

function reachableOutside(entry: string): string[] {
  const seen = new Set<string>();
  const outside = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
      if (!m[1].startsWith('.')) continue;
      const abs = path.resolve(path.dirname(f), m[1]);
      if (!abs.startsWith(AGENT + path.sep)) outside.add(path.relative(REPO, abs).split(path.sep).join('/'));
      queue.push(abs);
    }
  }
  return [...outside].sort();
}

/** Dockerfile の COPY の元 (build context = リポジトリ直下からの相対) */
function copySources(dockerfile: string): string[] {
  const out: string[] = [];
  for (const line of fs.readFileSync(dockerfile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*COPY\s+(?!--from)(.+)$/i);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/).filter((p) => !p.startsWith('--'));
    out.push(...parts.slice(0, -1).map((p) => p.replace(/^\.\//, '').replace(/\/$/, '')));
  }
  return out;
}

describe('agent-server の Docker イメージ (#555)', () => {
  const needed = reachableOutside(path.join(AGENT, 'src/index.mts'));
  const sources = copySources(path.join(AGENT, 'Dockerfile'));

  it('入口から agent-server の外へ辿れるファイルがある (0 ならこのテストが空振りしている)', () => {
    expect(needed.length).toBeGreaterThan(0);
  });

  it('★ 外のファイルはどれも Dockerfile でコピーされている', () => {
    const missing = needed.filter((f) => !sources.some((s) => f === s || f.startsWith(s + '/')));
    expect(missing).toEqual([]);
  });
});
