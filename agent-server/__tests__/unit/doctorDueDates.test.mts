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

  // ★ 2026-10-02 に向きを変えた。以前は「当日は まだ過ぎていない (info)」で、表示も「あと 1 日」だった。
  //   ★★ 期限の日に #456 が info・「あと 1 日」と出て、明日に読めた (申し送りは「当日 warn」と思い込んでいた)。
  //   この口が置かれた理由は「その日に誰も引かない」なので、当日に鳴らす
  it('★★ 当日は warn にして「今日が期限」と出す (★ その日に引かせるための口)', () => {
    const f = judgeDueDates([{ number: 453, title: '2026-10-16 に測る' }],
      new Date('2026-10-16T09:00:00+09:00'));
    expect(f.level).toBe('warn');
    expect(f.detail).toMatch(/#453 2026-10-16 \(★ 今日が期限\)/);
    expect(f.detail).not.toMatch(/あと/);
    expect(f.detail).not.toMatch(/過ぎています/);
  });

  it('★ 当日の終わり (23:59 JST) も当日、翌 0 時からは「過ぎた」', () => {
    const issues = [{ number: 453, title: '2026-10-16 に測る' }];
    // ★ 行の形まで見る (★★ info の見出し「今日が期限のもの・…ありません」にも同じ語が入っていて、語だけだと素通りした)
    const late = judgeDueDates(issues, new Date('2026-10-16T23:59:00+09:00'));
    expect(late.level).toBe('warn');
    expect(late.detail).toMatch(/#453 2026-10-16 \(★ 今日が期限\)/);
    expect(judgeDueDates(issues, new Date('2026-10-17T00:00:00+09:00')).detail).toMatch(/#453 2026-10-16 \(★ 1 日 過ぎています\)/);
  });

  it('★ 「あと N 日」は暦の日数 (★★ 明日なら「あと 1 日」。以前は「あと 2 日」と出ていた)', () => {
    const issues = [{ number: 453, title: '2026-10-17 に測る' }];
    expect(judgeDueDates(issues, new Date('2026-10-16T09:00:00+09:00')).detail).toMatch(/#453 2026-10-17 \(あと 1 日\)/);
    expect(judgeDueDates(issues, new Date('2026-10-16T00:30:00+09:00')).detail).toMatch(/\(あと 1 日\)/);
    expect(judgeDueDates(issues, new Date('2026-10-14T23:30:00+09:00')).detail).toMatch(/\(あと 3 日\)/);
  });

  it('★ 過ぎたものと今日のものが両方あれば、両方出す (古い順)', () => {
    const f = judgeDueDates([
      { number: 453, title: '2026-10-16 に測る' },
      { number: 454, title: '2026-10-10 に決める' },
      { number: 455, title: '2026-10-20 に見直す' },
    ], NOW);
    expect(f.level).toBe('warn');
    expect(f.detail).toMatch(/#454 2026-10-10 \(★ 6 日 過ぎています\)/);
    expect(f.detail).toMatch(/#453 2026-10-16 \(★ 今日が期限\)/);
    expect(f.detail.indexOf('#454')).toBeLessThan(f.detail.indexOf('#453'));
    expect(f.detail).not.toMatch(/#455/);
  });

  it('★ まだ先のものを 5 件で切ったら「ほか N 件」と出す (★★ 数と並びが合わないと「載っていない」と読まれる)', () => {
    const issues: DueIssue[] = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ number: 100 + d, title: `2026-11-0${d} に測る` }));
    const f = judgeDueDates(issues, NOW);
    expect(f.level).toBe('info');
    expect(f.detail).toMatch(/期限つき 7 件/);
    expect(f.detail).toMatch(/#105/);
    expect(f.detail).not.toMatch(/#106/);
    expect(f.detail).toContain('ほか 2 件 (最も遠いもの: #107 2026-11-07)');
  });

  it('5 件以下なら「ほか」は出さない', () => {
    const f = judgeDueDates([{ number: 1, title: '2026-11-01 に測る' }], NOW);
    expect(f.detail).not.toMatch(/ほか/);
  });
});
