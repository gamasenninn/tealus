/**
 * 期限つきの宿題に気づく口 (#453 系、2026-09-24)。
 *
 * ★ なぜ要るか: 「2026-10-15 に測る」「2026-10-20 に判断する」のような issue を置いても、
 *   **その日に誰も引かない**。★★ 2026-09-21 に「置いた≠動く」を 1 日 3 件出している。
 *   ★★★ 日々引かれている口 (doctor) に乗せて初めて、置いたものが動く。
 *
 * ★★★★ ci-status と同じ約束:
 *   1 引けなかったら「期限は無い」と言わない (info にして、**無いとは書かない**)
 *   2 何日 過ぎたかを出す (1 件だけ出すと「今日の 1 件」に見えて放置される)
 *   3 まだ先のものは warn にしない (★ 毎日鳴ると読まれなくなる)
 */
import { judgeDueDates, type DueIssue } from '../../src/lib/doctorDueDates.mts';

const NOW = new Date('2026-10-16T09:00:00+09:00');

describe('judgeDueDates', () => {
  it('★ 引けなかったら info。★★ 見ていないのに「過ぎたものは無い」とは言わない', () => {
    const f = judgeDueDates(null, NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/引けませんでした/);
    // ★ 守りたいのはここ —— 引けなかったことを「異常なし」と読ませない
    expect(f.detail).not.toMatch(/過ぎ/);
    expect(f.detail).not.toMatch(/期限つき.{0,8}(ありません|無し)/);
  });

  it('期限つきの issue が 1 件も無ければ info', () => {
    const f = judgeDueDates([{ number: 1, title: 'ふつうの issue' }], NOW);
    expect(f.level).toBe('info');
  });

  it('★★★★ 期限を過ぎていたら warn にして、過ぎた日数を出す', () => {
    const f = judgeDueDates([{ number: 453, title: '2026-10-15 に #452 の効き目を測る' }], NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).toMatch(/#453/);
    expect(f.detail).toMatch(/1 日/);
  });

  it('★ まだ先のものは warn にしない (毎日鳴ると読まれなくなる)', () => {
    const f = judgeDueDates([{ number: 436, title: 'techne を 2026-10-20 に判断する' }], NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/#436/);
  });

  it('★ 和暦まじりの表記 (2026年10月15日) も拾う', () => {
    const f = judgeDueDates([{ number: 99, title: '2026年10月15日 に見直す' }], NOW);
    expect(f.level).toBe('warn');
  });

  it('★★ 過ぎたものが複数あれば 全部出す (★ 1 件だけ出すと放置される)', () => {
    const f = judgeDueDates([
      { number: 453, title: '2026-10-15 に測る' },
      { number: 454, title: '2026-10-01 に決める' },
      { number: 455, title: '期限なし' },
    ], NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).toMatch(/#453/);
    expect(f.detail).toMatch(/#454/);
    expect(f.detail).not.toMatch(/#455/);
  });

  it('★ 過ぎたものは 古い順に並べる (★★ いちばん放置されているものが上)', () => {
    const f = judgeDueDates([
      { number: 453, title: '2026-10-15 に測る' },
      { number: 454, title: '2026-10-01 に決める' },
    ], NOW);
    expect(f.detail.indexOf('#454')).toBeLessThan(f.detail.indexOf('#453'));
  });

  it('★ 当日は まだ過ぎていない扱い (★★ その日のうちに引けばよい)', () => {
    const f = judgeDueDates([{ number: 453, title: '2026-10-16 に測る' }],
      new Date('2026-10-16T09:00:00+09:00'));
    expect(f.level).toBe('info');
  });
});
