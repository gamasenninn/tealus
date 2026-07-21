/**
 * format.ts — 表示用フォーマット純関数。
 * 集約前 (VoiceBubble/VoiceEditModal の formatTime, MessageBubble の formatTime) の振る舞いを固定。
 */
import { describe, it, expect } from 'vitest';
import { formatDuration, formatClockTime } from '../src/utils/format';

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
