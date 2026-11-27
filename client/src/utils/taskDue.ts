/**
 * タスクの期限 (docs/16 §5・§8-6、#661 タスク 33)。期限は日付だけ ('YYYY-MM-DD'、本体が字のまま返す)
 * ★ 「今日」はこの端末の暦の日付 (日本で使う前提 = 日本の日付)。toISOString() は UTC なので使わない
 *   (日本の 0〜9 時に前の日になる)
 * ★ 期限切れ = 今日より前・まだ済んでいない。今日まで = 今日・まだ済んでいない
 * ★ 保留 (区分 held、11-28) には出さない・数えない。時間稼ぎのために置いたものを急かさない (docs/16 §5)
 */
import type { Task } from '../types';

type DueLike = Pick<Task, 'due_date' | 'status'> & { section?: Task['section'] };
export type DueState = 'overdue' | 'today' | null;

const pad = (n: number) => String(n).padStart(2, '0');

export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'YYYY-MM-DD' どうしは字の順 = 日付の順 */
export function dueState(t: DueLike, today: string): DueState {
  if (!t.due_date || t.status === 'done' || t.section === 'held') return null;
  if (t.due_date < today) return 'overdue';
  if (t.due_date === today) return 'today';
  return null;
}

export function dueLabel(due: string): string {
  const [, m, d] = due.split('-');
  return `〆${Number(m)}/${Number(d)}`;
}

export function countOverdue(tasks: DueLike[], today: string): number {
  return tasks.filter((t) => dueState(t, today) === 'overdue').length;
}
