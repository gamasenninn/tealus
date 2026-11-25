/**
 * 改善ループ 108: `@cc-` の宛名の読み取りは本体と agent-server の両方にある (docs/14 で本体へ写した)。
 *
 * どちらが受け付けるかは `CC_INTAKE` で決まるので、片方だけ直すと「設定 1 つで配り先が変わる」。
 * ★ 届かない便は画面では普通に見える (投稿は成功し、ログは info/warn だけ) ので、ずれても気づけない。
 * 包みをまたぐ import はしない約束なので (ccWriter.mts の冒頭)、同じ中身の 2 ファイルを置き、ここで突き合わせる。
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8').replace(/\r\n/g, '\n');

describe('ccAddress.mts は本体と agent-server で同じ中身', () => {
  it('1 文字も違わない', () => {
    const server = read('server/src/services/cc/ccAddress.mts');
    const agent = read('agent-server/src/webhook/ccAddress.mts');
    expect(agent).toBe(server);
  });

  it('import を持たない (どちらの包みに置いても同じに動く)', () => {
    const server = read('server/src/services/cc/ccAddress.mts');
    expect(server).not.toMatch(/^import /m);
  });
});
