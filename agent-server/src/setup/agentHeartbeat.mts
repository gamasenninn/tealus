/**
 * agent-server の鼓動 (docs/09 §3.2、2026-11-01 改善ループ 33〜35 の承認 1)
 *
 * ★ 1 分ごとに本体の POST /api/bot/heartbeat へ { name: 'agent-server', info } を送る。
 *   - 止まれば、本体の見張りが「鼓動が来ていない」を業務メモに出す (agent-server が落ちた)
 *   - 共有の tealus の道具が欠けていれば info.problem に一文を入れる (生きているが働けない)
 * ★ 10-31 は生きているが道具がつながらない形で、AI が 28 分答えられなかった。本体から見ると webhook は届いていたので何も鳴らなかった
 * ★ 何を見張るか (閾値・部屋) は本体の watchdogs.json が決める。ここは事実を送るだけ
 */
import { sharedTealusProblem } from '../mcp/roomMcpManager.mts';
import { logger } from '../lib/logger.mts';

export const AGENT_HEARTBEAT_NAME = 'agent-server';
const DEFAULT_INTERVAL_MS = 60_000;

type Send = (name: string, info: Record<string, unknown>) => Promise<unknown>;

let timer: NodeJS.Timeout | null = null;
let failing = false;

export function agentHeartbeatInfo(): Record<string, unknown> {
  const problem = sharedTealusProblem();
  return problem ? { problem } : {};
}

function beat(send: Send): void {
  // ★ 同期で投げても (送り手が無い・info を作れない) 落とさず、失敗として数える
  let sent: Promise<unknown>;
  try { sent = send(AGENT_HEARTBEAT_NAME, agentHeartbeatInfo()); } catch (err) { sent = Promise.reject(err); }
  void sent
    .then(() => {
      if (failing) logger.info('[heartbeat] 本体へ鼓動を送れるようになりました');
      failing = false;
    })
    .catch((err: unknown) => {
      // ★ 失敗が続く間は 1 回だけ出す (本体の再起動中に 1 分ごとに警告で埋めない)
      if (!failing) logger.warn(`[heartbeat] 本体へ鼓動を送れません: ${err instanceof Error ? err.message : String(err)}`);
      failing = true;
    });
}

/** 鼓動を始める。★ 何回呼んでも 1 本だけ (ログインの試し直しで initializeAgent は何度も走る) */
export function startAgentHeartbeat(send: Send, intervalMs = DEFAULT_INTERVAL_MS): void {
  if (timer) return;
  beat(send);
  timer = setInterval(() => beat(send), intervalMs);
  timer.unref?.();
}

export function stopAgentHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
  failing = false;
}
