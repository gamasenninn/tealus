/**
 * doctor: メディアの総量・ディスクの空き・常駐のメモリ (2026-10-29 小野さん判断 13)
 *
 * ★ なぜ要るか: メディアは消さない方針 (10-10) で 1 日 300〜500MB 増える。メモリも記録が無く、
 *   長く動かしたときの傾向を見る手段が無かった。人が見に行くまで分からないので doctor の 1 行に出す
 * ★ 約束: 測れなかったものを「十分」と言わない / 空きが残り 90 日分を切ったら warn / 正常なら info
 */
import { judgeCapacity } from '../../src/lib/doctorCapacity.mts';

const GB = 1024 ** 3;

describe('judgeCapacity', () => {
  it('★ 総量・空き・直近 30 日の増え・もつ日数・メモリを 1 行に出す (正常は info)', () => {
    const f = judgeCapacity({
      media: { totalBytes: 42 * GB, last30Bytes: 9 * GB },
      freeBytes: 217 * GB,
      procs: [{ name: '本体', rssBytes: 156 * 1024 ** 2, hoursUp: 24.7 }],
    });
    expect(f.id).toBe('capacity');
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/42\.0GB/);
    expect(f.detail).toMatch(/217\.0GB/);
    expect(f.detail).toMatch(/9\.0GB/);
    expect(f.detail).toMatch(/約 723 日/);   // 217 / (9/30)
    expect(f.detail).toMatch(/本体 156MB/);
  });

  it('★★ 空きが残り 90 日分を切ったら warn', () => {
    const f = judgeCapacity({ media: { totalBytes: 42 * GB, last30Bytes: 9 * GB }, freeBytes: 20 * GB, procs: [] });
    expect(f.level).toBe('warn');
  });

  it('★ 測れなかったものは「測れなかった」と書き、もつ日数は言わない', () => {
    const f = judgeCapacity({ media: null, freeBytes: null, procs: [] });
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/測れませんでした/);
    expect(f.detail).not.toMatch(/日分|約 \d+ 日/);
  });
});
