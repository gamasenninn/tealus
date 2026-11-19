/**
 * 鼓動 (POST /api/bot/heartbeat) に載せる中身 (docs/12 §7・§12.6、docs/09 §3.2)。
 * ★ 載せるのは班の名前・状態・件数だけ。PC の名前・会話の id・届け先の名前は載せない (本体の DB に残るため)
 * ★ problem が空でない文字列なら、見張りが「動いてはいますが、<problem>」を業務メモに 1 回知らせる (docs/09)
 * ★ info は 2,000 字まで (本体の上限)。超えるときは班の一覧を省き、problem だけ残す
 */
import type { BridgeReport } from './tick.mts';

/** 確認待ちが続いたら知らせるまでの時間 (2026-11-19 利用者: 10 分) */
export const BLOCKED_ALERT_MS = 10 * 60_000;
/** 届け先が見つからない・分からないが続いたら知らせるまでの時間 */
export const MISSING_ALERT_MS = 10 * 60_000;
const INFO_MAX = 2000;

export function heartbeatInfo(reports: BridgeReport[], now: number): { bridges?: Record<string, { state: string; pending: number }>; problem?: string } {
  const problems: string[] = [];
  const bridges: Record<string, { state: string; pending: number }> = {};
  for (const r of reports) {
    bridges[r.project] = { state: r.state, pending: r.pending };
    const minutes = r.since === null ? 0 : Math.floor((now - r.since) / 60_000);
    if (r.state === 'blocked' && r.since !== null && now - r.since >= BLOCKED_ALERT_MS) {
      problems.push(`${r.project} が確認待ちのまま ${minutes} 分 (新着 ${r.pending} 件)`);
    } else if ((r.state === 'missing' || r.state === 'unknown') && r.since !== null && now - r.since >= MISSING_ALERT_MS) {
      problems.push(`${r.project} の届け先が見つかりません (${minutes} 分)`);
    } else if (r.state === 'held') {
      problems.push(`${r.project} の配達を保留しています (上限。人が保留の印を消すまで止めています)`);
    }
  }
  const info: { bridges?: Record<string, { state: string; pending: number }>; problem?: string } = { bridges };
  if (problems.length) info.problem = problems.join(' / ');
  if (JSON.stringify(info).length <= INFO_MAX) return info;
  // ★ 大きすぎるときは班の一覧を省き、problem だけ (それも長ければ切る)
  const problem = (info.problem ?? '').slice(0, INFO_MAX - 40);
  return problem ? { problem } : {};
}
