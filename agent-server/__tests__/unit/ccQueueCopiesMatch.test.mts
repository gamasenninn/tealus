/**
 * ★ 改善ループ 127: 受け箱の口 (cc-queue) は本体 (server/src/routes/ccQueue.mts、docs/14) と
 *   agent-server (src/routes/ccQueue.mts、CC_INTAKE が server でないとき) の 2 か所にある。
 *   寿命切断の見込み MAX_AGE_EXPECT_BACK_MS と 1 行の形 CcEvent は写しで、片方だけ直すと
 *   受け取る側 (listen-tealus の __bye 猶予) が口によって違う値を見る。
 * ★ import で 1 つにしないのは、本体のファイルが express・pool を読むため
 *   (包みをまたぐ import は node: 組み込みだけで閉じる先に限る、crossPackageImportGuard)。写しを突き合わせる
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const COPIES = ['server/src/routes/ccQueue.mts', 'agent-server/src/routes/ccQueue.mts'];

function pick(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

describe('cc-queue の口の写しが一致する', () => {
  const srcs = COPIES.map(read);

  it('MAX_AGE_EXPECT_BACK_MS (どちらにも 1 つずつ・同じ値)', () => {
    const vals = srcs.map((s) => pick(s, /const MAX_AGE_EXPECT_BACK_MS = ([^;]+);/g));
    expect(vals.map((v) => v.length)).toEqual([1, 1]);   // ★ 空振りで「両方 0 件 = 一致」にならないように
    expect(vals[0][0]).toBe(vals[1][0]);
  });

  it('CcEvent の形 (どちらにも 1 つずつ・同じ中身)', () => {
    const bodies = srcs.map((s) => pick(s, /interface CcEvent \{([^}]*)\}/g));
    expect(bodies.map((b) => b.length)).toEqual([1, 1]);
    expect(bodies[0][0]).toBe(bodies[1][0]);
    expect(bodies[0][0]).toContain('id?: string;');
  });
});
