/**
 * #545 % 委譲で部屋どうしが互いの答えを待ち合うと、9 分 (キューの時間切れ) 止まっていた
 *
 * ★ A の処理の中から B の列に並んで B の答えを待つ。同時に B の処理も A の列に並んで A を待つと、
 *   互いを待ったまま QUEUE_TASK_TIMEOUT (540 秒) まで「問い合わせ中...」のままだった
 * ★ 「どの部屋がどの部屋の答えを待っているか」を覚え、頼む相手をたどって自分に戻るなら、並ばずに断る
 */
import { beginWait, endWait, _resetWaits } from '../../src/webhook/delegationWait.mts';

describe('delegationWait (#545)', () => {
  beforeEach(() => _resetWaits());

  test('待ち合いが無ければ並べる', () => {
    expect(beginWait('A', 'B')).toBe(true);
  });

  test('★★ A が B を待っている間に、B が A を待とうとしたら断る', () => {
    expect(beginWait('A', 'B')).toBe(true);
    expect(beginWait('B', 'A')).toBe(false);
  });

  test('★ 3 つの部屋の輪 (A→B→C→A) も断る', () => {
    expect(beginWait('A', 'B')).toBe(true);
    expect(beginWait('B', 'C')).toBe(true);
    expect(beginWait('C', 'A')).toBe(false);
  });

  test('★ 待ち終わったら、また頼める', () => {
    expect(beginWait('A', 'B')).toBe(true);
    endWait('A', 'B');
    expect(beginWait('B', 'A')).toBe(true);
  });

  test('同じ相手へ並行して 2 つ頼んでも、片方が終わっただけでは待ちは消えない', () => {
    expect(beginWait('A', 'B')).toBe(true);
    expect(beginWait('A', 'B')).toBe(true);
    endWait('A', 'B');
    expect(beginWait('B', 'A')).toBe(false);
    endWait('A', 'B');
    expect(beginWait('B', 'A')).toBe(true);
  });

  test('輪にならない並び (A→B と C→B) は断らない', () => {
    expect(beginWait('A', 'B')).toBe(true);
    expect(beginWait('C', 'B')).toBe(true);
  });
});
