/**
 * 配る輪の 1 回分 (docs/12 §2・§8)。班ごとに:
 *   保留なら何もしない → queue を読む (読めなければ次の回) → カーソルの後ろの新着 → 届け先の状態 →
 *   空いていれば上限を見て、文面 1 通 → 受け付けられたらカーソルを進める
 *
 * ★ カーソルは受け付けられた範囲までしか進めない (§8 の 5)。届け先が忙しい・確認待ち・落ちているときは進めない
 * ★ まとめて 1 通 (§8 の 3)。作業中に来た便は、空いてから「新着 N 件」1 通にする
 * ★ 空回し (dryRun) は打たずに記録だけする (docs/12 §12.11)。カーソルも進めず、同じ判断を何度も記録しないよう手元で覚える
 * ★ 状態 (班ごとの state・新着の数・続いている時間) を返す。鼓動 (§7・§12.6) に載せるのは班の名前と状態と数だけ
 */
import path from 'node:path';
import { readQueue, newSince } from './queue.mts';
import { loadCursor, saveCursor } from './cursor.mts';
import { isHeld, setHold, RateLimiter } from './limit.mts';
import { buildNotice } from './notice.mts';
import type { Courier, CourierStatus } from './herdr.mts';

export interface Bridge { project: string; courier: Courier }

export type BridgeState = 'idle' | 'delivered' | 'busy' | 'blocked' | 'missing' | 'unknown' | 'held' | 'unreadable' | 'failed';

export interface BridgeReport { project: string; state: BridgeState; pending: number; since: number | null }

export interface TickDeps {
  queueDir: string;
  stateDir: string;
  limiter: RateLimiter;
  now: () => number;
  dryRun: boolean;
  /** 出来事の記録 (本文は渡さない) */
  record: (event: Record<string, unknown>) => void;
  /** 保留にしたときの知らせ (業務メモへ 1 回)。段階 1 は鼓動の problem に載せるだけでもよい */
  onHold?: (project: string, reason: string) => void;
}

/** 状態が変わった時刻を班ごとに覚える (「確認待ちが N 分続く」を出すため) */
const stateSince = new Map<string, { state: BridgeState; at: number }>();
/** 空回しで最後に記録した id (同じ判断を何度も記録しない) */
const dryCursor = new Map<string, string>();

export function resetTickMemory(): void { stateSince.clear(); dryCursor.clear(); }

function report(project: string, state: BridgeState, pending: number, now: number): BridgeReport {
  const prev = stateSince.get(project);
  if (!prev || prev.state !== state) stateSince.set(project, { state, at: now });
  return { project, state, pending, since: stateSince.get(project)!.at };
}

const busyLike: Record<Exclude<CourierStatus, 'idle'>, BridgeState> = {
  busy: 'busy', blocked: 'blocked', missing: 'missing', unknown: 'unknown',
};

export async function tickBridge(b: Bridge, d: TickDeps): Promise<BridgeReport> {
  const now = d.now();
  if (isHeld(d.stateDir, b.project)) return report(b.project, 'held', 0, now);

  const q = readQueue(path.join(d.queueDir, `${b.project}.jsonl`));
  if (!q.ok) return report(b.project, 'unreadable', 0, now);   // ★ 読めない瞬間は新着ともカーソルの消失ともみなさない

  const stored = loadCursor(d.stateDir, b.project);
  if (stored === null) {
    // ★ 初回は末尾から (過去分は流さない)
    const last = q.ids.length ? q.ids[q.ids.length - 1] : null;
    if (last && !d.dryRun) saveCursor(d.stateDir, b.project, last);
    if (last && d.dryRun) dryCursor.set(b.project, last);
    return report(b.project, 'idle', 0, now);
  }
  const cursor = d.dryRun ? (dryCursor.get(b.project) ?? stored) : stored;
  const fresh = newSince(q.ids, cursor);
  if (fresh.ids.length === 0) return report(b.project, 'idle', 0, now);

  const st = await b.courier.status();
  // ★ 空回しは届け先の状態によらず判断を記録する (herdr を起こす前でも、PaneDeck のトリガーの結果と ids で見比べられるように)
  if (st !== 'idle' && !d.dryRun) return report(b.project, busyLike[st], fresh.ids.length, now);

  if (!d.limiter.take(b.project)) {
    const reason = '1 時間に配る数の上限を超えた';
    setHold(d.stateDir, b.project, reason);
    d.record({ kind: 'held', project: b.project, reason });
    d.onHold?.(b.project, reason);
    return report(b.project, 'held', fresh.ids.length, now);
  }

  const text = buildNotice(b.project, fresh.ids.length, fresh.last!, fresh.lost);
  if (d.dryRun) {
    d.record({ kind: 'dry-run', project: b.project, count: fresh.ids.length, ids: fresh.ids, last: fresh.last, lost: fresh.lost, courier_status: st });
    dryCursor.set(b.project, fresh.last!);
    return report(b.project, 'delivered', 0, now);
  }

  const r = await b.courier.deliver(text);
  if (!r.ok) {
    d.record({ kind: 'deliver-failed', project: b.project, error: r.error });
    return report(b.project, r.error === 'blocked' ? 'blocked' : 'failed', fresh.ids.length, now);
  }
  saveCursor(d.stateDir, b.project, fresh.last!);   // ★ 受け付けられてから進める
  d.record({ kind: 'delivered', project: b.project, count: fresh.ids.length, last: fresh.last, lost: fresh.lost, ref: r.ref });
  return report(b.project, 'delivered', 0, now);
}
