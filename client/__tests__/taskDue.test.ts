/**
 * タスクの期限 (docs/16 §5・§8-6)。日付だけ。「今日」はこの端末の暦の日付 (日本で使う前提 = 日本の日付)
 * ★ 期限切れ = 今日より前・まだ済んでいない。今日まで = 今日・まだ済んでいない。済んだものには出さない
 */
import { describe, it, expect } from 'vitest';
import { localToday, dueState, dueLabel, countOverdue } from '../src/utils/taskDue';

describe('localToday — 端末の暦の日付を YYYY-MM-DD で', () => {
  it('月・日は 2 桁', () => {
    expect(localToday(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('★ 日の境目: 23:59:59 はその日、0:00 は次の日 (UTC に直さない。日本の 0〜9 時に前の日にならない)', () => {
    expect(localToday(new Date(2026, 10, 30, 23, 59, 59))).toBe('2026-11-30');
    expect(localToday(new Date(2026, 11, 1, 0, 0, 0))).toBe('2026-12-01');
    expect(localToday(new Date(2026, 11, 1, 8, 59, 59))).toBe('2026-12-01');
  });
});

describe('dueState', () => {
  const today = '2026-11-30';
  it('今日より前で済んでいなければ期限切れ', () => {
    expect(dueState({ due_date: '2026-11-29', status: 'open' }, today)).toBe('overdue');
  });
  it('★ 保留 (区分 held、11-28) には期限切れ・今日までを出さない。時間稼ぎのために置いたものを急かさない', () => {
    expect(dueState({ due_date: '2025-12-31', status: 'open', section: 'held' }, today)).toBeNull();
    expect(dueState({ due_date: '2026-11-30', status: 'open', section: 'held' }, today)).toBeNull();
    expect(countOverdue([{ due_date: '2025-12-31', status: 'open', section: 'held' }, { due_date: '2025-12-31', status: 'open', section: 'do' }], today)).toBe(1);
  });
  it('今日なら今日まで', () => {
    expect(dueState({ due_date: '2026-11-30', status: 'open' }, today)).toBe('today');
  });
  it('明日以降・期限なし・済みには何も出さない', () => {
    expect(dueState({ due_date: '2026-12-01', status: 'open' }, today)).toBeNull();
    expect(dueState({ due_date: null, status: 'open' }, today)).toBeNull();
    expect(dueState({ due_date: '2026-11-01', status: 'done' }, today)).toBeNull();
    expect(dueState({ due_date: '2026-11-30', status: 'done' }, today)).toBeNull();
  });
  it('年をまたいでも字の順で比べられる', () => {
    expect(dueState({ due_date: '2026-12-31', status: 'open' }, '2027-01-01')).toBe('overdue');
  });
});

describe('dueLabel / countOverdue', () => {
  it('〆月/日 (先頭の 0 は付けない)', () => {
    expect(dueLabel('2026-11-30')).toBe('〆11/30');
    expect(dueLabel('2027-01-05')).toBe('〆1/5');
  });
  it('期限切れだけ数える', () => {
    const ts = [
      { due_date: '2026-11-29', status: 'open' as const },
      { due_date: '2026-11-30', status: 'open' as const },
      { due_date: '2026-11-01', status: 'done' as const },
      { due_date: null, status: 'open' as const },
      { due_date: '2026-10-01', status: 'open' as const, section: 'held' as const },
    ];
    expect(countOverdue(ts, '2026-11-30')).toBe(1);   // 保留は数えない (11-28)
  });
});
