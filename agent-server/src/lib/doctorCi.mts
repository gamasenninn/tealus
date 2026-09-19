/**
 * CI が赤いことに気づく口 (#441 系、2026-09-19)。
 *
 * ★ なぜ要るか: CI は 2026-09-05 から 09-19 まで **14 日 / 51 回 赤**のまま誰も気づかなかった。
 *   見つかったのは push のついでに偶然 CI を見たからで、仕組みではない。
 *
 * ★★ **自動で直さない。引ける口に出すだけ** (doctor の他の口と同じ扱い)。
 *
 * ★★★ 設計上の約束 3 つ:
 *   1. **引けなかったら「緑」と言わない。** gh が無い / 認証切れ / オフラインは
 *      `info` にするが、★ 「成功」という語を出さない (= 壊れた値は沈黙より悪い)
 *   2. **連続して赤い回数と、最後の成功からの日数を出す。**
 *      1 件だけ出すと「今日の 1 件」に見えて放置される (★ 実際 14 日 放置された)
 *   3. **進行中 (conclusion が無い) は判定に使わない。** 走っている最中を失敗と数えない
 */
import type { Finding } from './doctor.mts';

/** `gh run list --json conclusion,createdAt,url` の 1 行分 */
export interface CiRun {
  /** 'success' | 'failure' | 'cancelled' など。★ 進行中は null */
  conclusion: string | null;
  createdAt: string;
  url?: string;
}

const DAY_MS = 86_400_000;

/**
 * CI の履歴から所見を作る。
 * @param runs 新しい順。★ 引けなかったときは null を渡す (空配列と区別する)
 */
export function judgeCiStatus(runs: CiRun[] | null, now: Date): Finding {
  if (runs === null) {
    return {
      id: 'ci-status',
      level: 'info',
      detail: '★ CI の状態を引けませんでした (gh が無い / 認証切れ / オフライン)',
      fix: '★ `gh auth status` を確認。★★ 引けないことと「緑であること」は別なので、ここでは判定しません',
    };
  }
  // ★ 進行中は判定に使わない
  const done = runs.filter((r) => r.conclusion !== null && r.conclusion !== undefined);
  if (done.length === 0) {
    return {
      id: 'ci-status',
      level: 'info',
      detail: '★ 判定できる実行がありません (履歴が空、または全部 進行中)',
      fix: '★ しばらく後にもう一度引くこと',
    };
  }
  const latest = done[0]!;
  if (latest.conclusion === 'success') {
    return {
      id: 'ci-status',
      level: 'info',
      detail: '最新の CI は 成功',
      fix: '★ 赤くなったらここが warn になります (連続回数と、最後の成功からの日数つき)',
    };
  }
  // ★ 連続で赤い回数
  let streak = 0;
  for (const r of done) {
    if (r.conclusion === 'success') break;
    if (r.conclusion === 'cancelled') continue;  // 取り消しは赤に数えない
    streak += 1;
  }
  const lastGreen = done.find((r) => r.conclusion === 'success');
  const days = lastGreen
    ? Math.floor((now.getTime() - new Date(lastGreen.createdAt).getTime()) / DAY_MS)
    : null;
  const span = days === null
    ? `★ 引いた範囲 (${done.length} 件) に成功が 1 つもありません`
    : `最後の成功から ${days} 日`;
  return {
    id: 'ci-status',
    level: 'warn',
    detail: `★ CI が赤いままです — 連続 ${streak} 回 / ${span}`,
    fix: `★ ${latest.url ?? 'gh run view'} を開く。★★ 失敗が重なっていることがあるので、`
      + '上の層を直したら **その下に別の失敗が出ないか**まで見ること (2026-09-19 は 2 段だった)',
  };
}

/**
 * `gh` から CI の履歴を引く。★ 引けなければ null (= 「緑」とは言わない)。
 *
 * ★★ **何も送らない。** 自分のリポジトリの実行結果を読むだけ。
 * ★★★ 短い timeout で諦める (doctor を待たせない)。
 */
export async function fetchCiRuns(limit = 30, timeoutMs = 4000): Promise<CiRun[] | null> {
  const { execFile } = await import('node:child_process');
  return await new Promise<CiRun[] | null>((resolve) => {
    const child = execFile(
      'gh',
      ['run', 'list', '--limit', String(limit), '--json', 'conclusion,createdAt,url'],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed: unknown = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? (parsed as CiRun[]) : null);
        } catch {
          resolve(null);
        }
      },
    );
    child.on('error', () => resolve(null));
  });
}
