/**
 * #476 日付へ飛ぶ の時差と日・月の区切り。改善ループ 134 で messages.mts の道から出した (中身は同じ)
 * ★ DB での結果は結合テスト (messageDays) が見ている。ここは区切りの計算を固定する
 */
import { dayRangeUtc, monthRangeUtc, parseTzOffset } from '../../src/services/dayRange.mts';

describe('parseTzOffset (画面の getTimezoneOffset、分)', () => {
  it('整数の文字だけ。±14 時間まで', () => {
    expect(parseTzOffset('-540')).toBe(-540);
    expect(parseTzOffset('0')).toBe(0);
    expect(parseTzOffset('840')).toBe(840);
    expect(parseTzOffset('-840')).toBe(-840);
    expect(parseTzOffset('841')).toBeNull();
    expect(parseTzOffset('-841')).toBeNull();
  });
  it('読めないものは null', () => {
    expect(parseTzOffset(undefined)).toBeNull();
    expect(parseTzOffset('5.5')).toBeNull();
    expect(parseTzOffset('+540')).toBeNull();
    expect(parseTzOffset('')).toBeNull();
    expect(parseTzOffset(['-540'])).toBeNull();
    expect(parseTzOffset(-540)).toBeNull();
  });
});

describe('monthRangeUtc', () => {
  it('日本 (-540): 11 月は 10/31 15:00Z 〜 11/30 15:00Z', () => {
    const r = monthRangeUtc('2026-11', -540)!;
    expect(r.from.toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });
  it('12 月は翌年の 1 月まで', () => {
    const r = monthRangeUtc('2026-12', 0)!;
    expect(r.from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('形が違えば null', () => {
    expect(monthRangeUtc('2026-13', 0)).toBeNull();
    expect(monthRangeUtc('2026-1', 0)).toBeNull();
    expect(monthRangeUtc('', 0)).toBeNull();
  });
});

describe('dayRangeUtc', () => {
  it('日本の 11/26 は 11/25 15:00Z から 24 時間', () => {
    const r = dayRangeUtc('2026-11-26', -540);
    if (typeof r === 'string') throw new Error(r);
    expect(r.from.toISOString()).toBe('2026-11-25T15:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-26T15:00:00.000Z');
  });
  it('うるう日は通る・無い日 (2/30、平年の 2/29) は bad-date', () => {
    expect(typeof dayRangeUtc('2028-02-29', 0)).toBe('object');
    expect(dayRangeUtc('2026-02-29', 0)).toBe('bad-date');
    expect(dayRangeUtc('2026-02-30', 0)).toBe('bad-date');
    expect(dayRangeUtc('2026-04-31', 0)).toBe('bad-date');
  });
  it('形が違えば bad-format', () => {
    expect(dayRangeUtc('2026-11-32', 0)).toBe('bad-format');
    expect(dayRangeUtc('2026/11/26', 0)).toBe('bad-format');
    expect(dayRangeUtc('', 0)).toBe('bad-format');
  });
});
