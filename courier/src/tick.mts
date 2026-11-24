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
import { readQueue, newSince, QUEUE_BEGIN } from './queue.mts';
import { loadCursor, saveCursor } from './cursor.mts';
import { isHeld, setHold, RateLimiter } from './limit.mts';
import { buildNotice } from './notice.mts';
import type { Courier, CourierStatus } from './herdr.mts';

export interface Bridge {
  project: string; courier: Courier; dryRun?: boolean;
  /** 便を読むフォルダ。無ければ deps.queueDir。段階 3 (docs/12 §14) は取り寄せた写しのフォルダ */
  queueDir?: string;
}

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
/** 新着が無いときに届け先の状態を見た時刻と結果 (10 秒に 1 回だけ見る。管理画面を 10 秒ごとに読み直すのに合わせた、2026-11-20) */
const lastLook = new Map<string, { at: number; state: BridgeState }>();
/** 新着が無いときに届け先の状態を見る間隔 */
export const IDLE_LOOK_MS = 10_000;
/** 空回しで最後に記録した id (同じ判断を何度も記録しない) */
const dryCursor = new Map<string, string>();
/** 打ったが戻りが失われた便 (docs/12 §13.2)。次の回に相手の進み具合が変わっていれば届いたとみなす */
const uncertainSent = new Map<string, { last: string; seq: number; count: number; at: number }>();
/** 戻りが分からなかった便を、進み具合が変わらないまま打ち直すまでに待つ時間 (相手が遅れて動き出すことがある) */
export const UNCERTAIN_RETRY_MS = 30_000;
/** 届かなかった時刻 (打ち直しを FAILED_RETRY_MS あける。改善ループ 104) */
const failedAt = new Map<string, number>();
/** 届かなかった便を打ち直すまでに待つ時間。★ あけないと、届け先が失敗を返し続ける間 3 秒ごとに打ち続ける (1 日 約 2.9 万回) */
export const FAILED_RETRY_MS = 30_000;
/** 保留だった班 (印が消えたのを見た回に数えを空にするため) */
const wasHeld = new Set<string>();

export function resetTickMemory(): void { stateSince.clear(); dryCursor.clear(); lastLook.clear(); uncertainSent.clear(); failedAt.clear(); }

function report(project: string, state: BridgeState, pending: number, now: number): BridgeReport {
  const prev = stateSince.get(project);
  if (!prev || prev.state !== state) stateSince.set(project, { state, at: now });
  return { project, state, pending, since: stateSince.get(project)!.at };
}

const busyLike: Record<Exclude<CourierStatus, 'idle'>, BridgeState> = {
  busy: 'busy', blocked: 'blocked', missing: 'missing', unknown: 'unknown',
};

export async function tickBridge(b: Bridge, deps: TickDeps): Promise<BridgeReport> {
  // ★ 班ごとの空回し (bridges.json の dry_run)。全体の空回し (deps.dryRun) が立っていれば、どの班も空回し
  const d: TickDeps = { ...deps, dryRun: deps.dryRun || b.dryRun === true };
  const now = d.now();
  if (isHeld(d.stateDir, b.project)) { wasHeld.add(b.project); return report(b.project, 'held', 0, now); }
  // ★ 人が印を消した。数えはメモリにあるので、ここで空にしないと 1 時間の窓が明けるまで再保留する (2026-11-23 印を消して 4 秒後にまた保留)
  if (wasHeld.delete(b.project)) d.limiter.reset(b.project);

  // ★ 空回しはカーソルのファイルを作らないので、手元で覚えたカーソルを先に見る。
  //   以前はファイルだけを見ていて、空回しでは毎回「初回」と見なして末尾へ飛び直し、新着を 1 つも記録しなかった
  //   (2026-11-19 18:36〜18:59 の本番で 4 便を記録しなかった)
  const stored = (d.dryRun ? dryCursor.get(b.project) : undefined) ?? loadCursor(d.stateDir, b.project);

  const q = readQueue(path.join(b.queueDir ?? d.queueDir, `${b.project}.jsonl`));
  if (!q.ok) {
    // ★ queue のファイルがまだ無い班 (一度も便が来ていない) は「先頭から」の印を置く。置かないと、最初の便で
    //   ファイルが現れたときに「初回は末尾から」と見なし、その 1 便を配らずに飛ばす (2026-11-19 オントロジー本班)
    // ★ 段階 3 (b.queueDir = 取り寄せた写し) では、写しが無いのは「まだ取り寄せていない」こと。ここで印を置くと、
    //   最初の取り寄せで過去分が全部入ったときに全部を配ってしまう (2026-11-21)。写しは取れた時点で必ず作られる (httpQueue)
    // ★ 写しが空 (取れたが便が一度も無い) も「先頭から」。写しは置き換えで書くので、書きかけで空に見える瞬間は無い
    //   (手元の queue は書き直しの途中で空に見えうるので、こちらは今までどおり読めないとみなす)
    const begin = b.queueDir ? q.reason === 'empty' : q.reason === 'ENOENT';
    if (stored === null && begin) {
      if (d.dryRun) dryCursor.set(b.project, QUEUE_BEGIN);
      else saveCursor(d.stateDir, b.project, QUEUE_BEGIN);
    }
    return report(b.project, 'unreadable', 0, now);   // ★ 読めない瞬間は新着ともカーソルの消失ともみなさない
  }
  if (stored === null) {
    // ★ 初回は末尾から (過去分は流さない)
    const last = q.ids.length ? q.ids[q.ids.length - 1] : null;
    if (last && !d.dryRun) saveCursor(d.stateDir, b.project, last);
    if (last && d.dryRun) dryCursor.set(b.project, last);
    return report(b.project, 'idle', 0, now);
  }
  const cursor = d.dryRun ? (dryCursor.get(b.project) ?? stored) : stored;
  const fresh = newSince(q.ids, cursor);
  if (fresh.ids.length === 0) {
    // ★ 空回しの班は見に行かない (まだ移していない班の届け先は居ないのが普通で、「居ない」と鳴ってしまう。2026-11-20 PaneDeck 班)
    if (d.dryRun) return report(b.project, 'idle', 0, now);
    // ★ 新着が無くても 10 秒ごとに届け先の状態を見る (管理画面の一覧と、便が無いときの確認待ちの知らせのため、2026-11-20)。
    //   見るだけで打たない・カーソルも動かさない
    const prev = lastLook.get(b.project);
    if (prev && now - prev.at < IDLE_LOOK_MS) return report(b.project, prev.state, 0, now);
    const st0 = await b.courier.status();
    const state: BridgeState = st0 === 'idle' ? 'idle' : busyLike[st0];
    lastLook.set(b.project, { at: now, state });
    return report(b.project, state, 0, now);
  }
  lastLook.delete(b.project);

  // ★ 前の回に打ったが戻りが失われた (SSH 越し)。相手の進み具合が変わっていれば届いたとみなし、打ち直さない (docs/12 §13.2)。
  //   変わっていなければ届いていないので、下でもう一度打つ。★ 二重に届けるより、遅れるほうがよい
  const pendingUncertain = uncertainSent.get(b.project);
  if (pendingUncertain) {
    const seqNow = (await b.courier.progress?.()) ?? null;
    if (seqNow !== null && seqNow !== pendingUncertain.seq) {
      uncertainSent.delete(b.project);
      saveCursor(d.stateDir, b.project, pendingUncertain.last);
      d.record({ kind: 'delivered', project: b.project, count: pendingUncertain.count, last: pendingUncertain.last, confirmed_late: true });
      return report(b.project, 'delivered', 0, now);
    }
    // ★ 変わっていなくても、すぐには打ち直さない (相手が遅れて動き出すと二重になる)。30 秒たってから
    if (now - pendingUncertain.at < UNCERTAIN_RETRY_MS) return report(b.project, 'unknown', fresh.ids.length, now);
    uncertainSent.delete(b.project);
  }

  // ★ 前の回に届かなかった。30 秒たつまでは打ち直さず「届かない」のまま (続いた時間は鼓動の problem に載る)
  const lastFail = failedAt.get(b.project);
  if (lastFail !== undefined && now - lastFail < FAILED_RETRY_MS) return report(b.project, 'failed', fresh.ids.length, now);

  const st = await b.courier.status();
  // ★ 空回しは届け先の状態によらず判断を記録する (herdr を起こす前でも、PaneDeck のトリガーの結果と ids で見比べられるように)
  if (st !== 'idle' && !d.dryRun) return report(b.project, busyLike[st], fresh.ids.length, now);

  // ★ 空回しは上限に数えない・保留の印を書かない (改善ループ 105)。上限の前に置かないと、何も配っていないのに
  //   41 便目で hold-<班>.json を書き、業務メモに「保留」が出て、以後の記録も止まっていた
  if (d.dryRun) {
    d.record({ kind: 'dry-run', project: b.project, count: fresh.ids.length, ids: fresh.ids, last: fresh.last, lost: fresh.lost, courier_status: st });
    dryCursor.set(b.project, fresh.last!);
    return report(b.project, 'delivered', 0, now);
  }

  if (!d.limiter.take(b.project)) {
    const reason = '1 時間に配る数の上限を超えた';
    setHold(d.stateDir, b.project, reason);
    wasHeld.add(b.project);   // ★ 次の回に印が消えていれば数えを空にする (上の isHeld より先に印が消されることがある)
    d.record({ kind: 'held', project: b.project, reason });
    d.onHold?.(b.project, reason);
    return report(b.project, 'held', fresh.ids.length, now);
  }

  const text = buildNotice(b.project, fresh.ids.length, fresh.last!, fresh.lost);
  const seqBefore = (await b.courier.progress?.()) ?? null;
  const r = await b.courier.deliver(text);
  if (!r.ok && r.error === 'uncertain' && seqBefore !== null) {
    uncertainSent.set(b.project, { last: fresh.last!, seq: seqBefore, count: fresh.ids.length, at: now });
    d.record({ kind: 'deliver-uncertain', project: b.project, count: fresh.ids.length, last: fresh.last });
    return report(b.project, 'unknown', fresh.ids.length, now);
  }
  if (!r.ok) {
    d.limiter.refund(b.project);
    if (r.error !== 'blocked') failedAt.set(b.project, now);   // ★ 届かなかった回は数えない (失敗が続くと「上限」の保留に化ける。uncertain は届いたかもしれないので数えたまま)
    d.record({ kind: 'deliver-failed', project: b.project, error: r.error });
    return report(b.project, r.error === 'blocked' ? 'blocked' : 'failed', fresh.ids.length, now);
  }
  failedAt.delete(b.project);
  saveCursor(d.stateDir, b.project, fresh.last!);   // ★ 受け付けられてから進める
  d.record({ kind: 'delivered', project: b.project, count: fresh.ids.length, last: fresh.last, lost: fresh.lost, ref: r.ref });
  return report(b.project, 'delivered', 0, now);
}
