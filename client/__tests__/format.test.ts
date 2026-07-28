/**
 * format.ts — 表示用フォーマット純関数。
 * 集約前 (VoiceBubble/VoiceEditModal の formatTime, MessageBubble の formatTime) の振る舞いを固定。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDuration, formatClockTime, formatRelativeDay } from '../src/utils/format';

describe('formatDuration', () => {
  it('0 / NaN / Infinity は "0:00"', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });

  it('秒を m:ss に整形 (秒はゼロ詰め、分は詰めない)', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3661)).toBe('61:01');
  });

  it('端数秒は切り捨て', () => {
    expect(formatDuration(65.9)).toBe('1:05');
  });
});

describe('formatClockTime', () => {
  it('ISO 日時を HH:MM (2桁:2桁) に整形', () => {
    // 表示値は実行環境の TZ 依存だが、書式 (2桁:2桁) は不変
    expect(formatClockTime('2026-07-21T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClockTime('2026-07-21T23:59:00+09:00')).toMatch(/^\d{2}:\d{2}$/);
  });
});

// #354 履歴一覧の「いつ使った指示か」の粗い目印
describe('formatRelativeDay', () => {
  const NOW = new Date('2026-07-28T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

  afterEach(() => { vi.useRealTimers(); });

  function at(iso: string): string {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return formatRelativeDay(iso);
  }

  it('当日は "今日"、前日は "昨日"', () => {
    expect(at(daysAgo(0))).toBe('今日');
    expect(at(daysAgo(1))).toBe('昨日');
  });

  it('2〜6 日は日数', () => {
    expect(at(daysAgo(2))).toBe('2日前');
    expect(at(daysAgo(6))).toBe('6日前');
  });

  it('7 日以上は週、30 日以上は月、365 日以上は年', () => {
    expect(at(daysAgo(7))).toBe('1週間前');
    expect(at(daysAgo(29))).toBe('4週間前');
    expect(at(daysAgo(30))).toBe('1か月前');
    expect(at(daysAgo(364))).toBe('12か月前');
    expect(at(daysAgo(365))).toBe('1年前');
  });

  it('未来日時 (端末時計のずれ) は "今日" に丸める', () => {
    expect(at(daysAgo(-3))).toBe('今日');
  });

  it('不正な日時は空文字', () => {
    expect(at('not-a-date')).toBe('');
  });
});
