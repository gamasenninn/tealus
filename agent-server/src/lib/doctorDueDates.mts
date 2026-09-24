/**
 * 期限つきの宿題に気づく口 (#453 系、2026-09-24)。
 *
 * ★ なぜ要るか: 「2026-10-15 に測る」「2026-10-20 に判断する」のような issue を置いても、
 *   **その日に誰も引かない**。★★ 2026-09-21 に「置いた≠動く」を 1 日 3 件出している。
 *   ★★★ 日々引かれている口 (doctor) に乗せて初めて、置いたものが動く。
 *
 * ★★★★ **自動で何もしない。引ける口に出すだけ** (doctor の他の口と同じ扱い)。
 *
 * ★★★★★ ci-status と同じ約束 3 つ:
 *   1. **引けなかったら「期限は無い」と言わない。** gh が無い / 認証切れ / オフラインは
 *      `info` にするが、★ 「ありません」という語を出さない (= 壊れた値は沈黙より悪い)
 *   2. **何日 過ぎたかを出し、過ぎたものは全部出す。** 1 件だけ出すと
 *      「今日の 1 件」に見えて放置される
 *   3. **まだ先のものは warn にしない。** ★ 毎日鳴る口は読まれなくなる
 */
import type { Finding } from './doctor.mts';

/** `gh issue list --json number,title` の 1 行分 */
export interface DueIssue {
  number: number;
  title: string;
}

/**
 * 題名の中の期限。★ 2 形を見る —— `2026-10-15` と `2026年10月15日`。
 * ★★ 題名に置く約束にしているのは、**一覧で見えるから** (本文だと引かないと分からない)。
 */
const DUE_PATTERNS = [
  /(\d{4})-(\d{2})-(\d{2})/,
  /(\d{4})年(\d{1,2})月(\d{1,2})日/,
];

/** 題名から期限を取る。★ 無ければ null */
export function dueDateOf(title: string): Date | null {
  for (const p of DUE_PATTERNS) {
    const m = p.exec(title);
    if (!m) continue;
    const [, y, mo, d] = m;
    // ★ JST の 0 時。★★ 「当日はまだ過ぎていない」にするため、判定は翌 0 時と比べる
    const dt = new Date(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+09:00`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

const DAY_MS = 86_400_000;

/**
 * 期限つきの issue から所見を作る。
 * @param issues 開いている issue。★ 引けなかったときは null を渡す (空配列と区別する)
 */
export function judgeDueDates(issues: DueIssue[] | null, now: Date): Finding {
  if (issues === null) {
    return {
      id: 'due-dates',
      level: 'info',
      detail: '★ 期限つきの issue を引けませんでした (gh が無い / 認証切れ / オフライン)',
      fix: '★ `gh auth status` を確認。★★ 引けないことと「期限が来ていないこと」は別なので、ここでは判定しません',
    };
  }
  const dated = issues
    .map((i) => ({ ...i, due: dueDateOf(i.title) }))
    .filter((i): i is DueIssue & { due: Date } => i.due !== null)
    .sort((a, b) => a.due.getTime() - b.due.getTime());

  if (dated.length === 0) {
    return {
      id: 'due-dates',
      level: 'info',
      detail: '★ 題名に期限を書いた issue はありませんでした',
      fix: '★ 期限のある宿題は **題名に日付を入れる** (例「2026-10-15 に … を測る」)。★★ 本文に書くと この口に出ません',
    };
  }

  // ★ 当日はまだ過ぎていない (その日のうちに引けばよい) → 翌 0 時を境にする
  const overdue = dated.filter((i) => now.getTime() >= i.due.getTime() + DAY_MS);
  const upcoming = dated.filter((i) => now.getTime() < i.due.getTime() + DAY_MS);
  const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

  if (overdue.length === 0) {
    const lines = upcoming.slice(0, 5).map((i) => {
      const days = Math.ceil((i.due.getTime() + DAY_MS - now.getTime()) / DAY_MS);
      return `    #${i.number} ${ymd(i.due)} (あと ${days} 日): ${i.title.slice(0, 48)}`;
    });
    return {
      id: 'due-dates',
      level: 'info',
      detail: `★ 期限つき ${dated.length} 件。★★ 過ぎたものはありません\n${lines.join('\n')}`,
      fix: '★ 期限の日にこの口が warn になります',
    };
  }

  const lines = overdue.map((i) => {
    const days = Math.floor((now.getTime() - i.due.getTime()) / DAY_MS);
    return `    #${i.number} ${ymd(i.due)} (★ ${days} 日 過ぎています): ${i.title.slice(0, 48)}`;
  });
  return {
    id: 'due-dates',
    level: 'warn',
    detail: `★★★★ 期限を過ぎた宿題 ${overdue.length} 件 (★ 古い順)\n${lines.join('\n')}`,
    fix: '★ 引くか、期限を書き直すか、close するか。★★ **放っておくと この口は毎日 鳴り続けます** (それが狙いです)',
  };
}

/**
 * 開いている issue を引く。★ 引けなければ null (★★ 空配列と区別する)。
 * ★★★ `ci-status` と同じ扱い —— 自分のリポジトリを読むだけで、送るものは無い。
 */
export async function fetchOpenIssues(limit = 60, timeoutMs = 4000): Promise<DueIssue[] | null> {
  const { execFile } = await import('node:child_process');
  return await new Promise<DueIssue[] | null>((resolve) => {
    const child = execFile(
      'gh',
      ['issue', 'list', '--state', 'open', '--limit', String(limit), '--json', 'number,title'],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed: unknown = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? (parsed as DueIssue[]) : null);
        } catch {
          resolve(null);
        }
      },
    );
    child.on('error', () => resolve(null));
  });
}
