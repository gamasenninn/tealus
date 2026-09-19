/**
 * #441 系 — CI が赤いことに気づく口 (2026-09-19)。
 *
 * ★ なぜ要るか: CI は 2026-09-05 から 2026-09-19 まで **14 日 / 51 回 赤**だったが、
 *   誰も気づかなかった。見つかったのは push のついでに偶然 CI を見たからで、仕組みではない。
 * ★★ 失敗が 2 つ重なっており、上の層 (typecheck) が下の層 (テスト) を隠していた。
 *   **連続で何日赤か**を出さないと「今日の 1 件」に見えて放置される。
 * ★★★ 引けなかったときに「緑」と言わないこと (= 壊れた値は沈黙より悪い)。
 */
import { judgeCiStatus, type CiRun } from '../../src/lib/doctorCi.mts';

const run = (conclusion: string | null, daysAgo: number): CiRun => ({
  conclusion,
  createdAt: new Date(Date.UTC(2026, 8, 19, 12, 0, 0) - daysAgo * 86400_000).toISOString(),
  url: 'https://example.invalid/run',
});
const NOW = new Date(Date.UTC(2026, 8, 19, 12, 0, 0));

describe('judgeCiStatus', () => {
  it('最新が成功なら info', () => {
    const f = judgeCiStatus([run('success', 0), run('failure', 1)], NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toContain('成功');
  });

  it('最新が失敗なら warn', () => {
    const f = judgeCiStatus([run('failure', 0), run('success', 1)], NOW);
    expect(f.level).toBe('warn');
  });

  it('★ 連続して赤い日数と回数を出す (「今日の 1 件」に見せない)', () => {
    const runs = [run('failure', 0), run('failure', 5), run('failure', 14), run('success', 15)];
    const f = judgeCiStatus(runs, NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).toContain('3');   // 連続失敗 3 回
    expect(f.detail).toMatch(/1[45]/); // 最後の成功から 14〜15 日
  });

  it('★★ 引けなかったら「緑」と言わない — info だが成功とは書かない', () => {
    const f = judgeCiStatus(null, NOW);
    expect(f.level).toBe('info');
    expect(f.detail).not.toContain('成功');
    expect(f.detail).toMatch(/引け|取得|不明/);
  });

  it('★ 実行履歴が空でも落ちない', () => {
    const f = judgeCiStatus([], NOW);
    expect(f.level).toBe('info');
    expect(f.detail).not.toContain('成功');
  });

  it('進行中 (conclusion=null) は判定に使わない', () => {
    const f = judgeCiStatus([run(null, 0), run('success', 1)], NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toContain('成功');
  });
});
