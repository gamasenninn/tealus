/**
 * Light (通常応答) の中断 registry
 *
 * Deep (#250 / `deepRegistry.mts`) と対になるが、**止め方が違う**。
 *
 * ```
 * Deep   spawn した ChildProcess を自分で握っている → kill できる
 * Light  codex SDK が spawn を隠蔽する            → ★ ハンドルが無い
 * ```
 *
 * そこで Light は 2 段で止める:
 *
 * ```
 * ① 協調フラグ   走行中の processLight が event loop の頭で isCancelled() を見て break
 * ② sweep kill   deepRegistry.sweepByWorkspacePath() で codex.exe / node.exe を落とす
 * ```
 *
 * ★ **① だけでは足りない。** Light v2 は MCP 経由で `send_message` を持つので、
 *   loop を抜けてもプロセスが生きていれば**部屋に投稿し続けられる**。
 *   #252 (Deep cancel が claude.exe を取り逃して裏で走り続けた critical bug) と同じ形なので、
 *   「フラグを立てるだけ」にはしない。
 *
 * ★ **cancel() は Map から消さない。** deepRegistry は kill するので消してよいが、
 *   こちらは協調なので、走行中の loop が次に isCancelled() を読むまで entry が要る。
 *   後始末 (unregister) は必ず処理側の finally が行う。
 */
import { sweepByWorkspacePath, type CancelResult } from './deepRegistry.mts';
import { logger } from '../lib/logger.mts';

export type { CancelResult };

interface LightRun {
  cancelled: boolean;
  workspacePath?: string;
}

const runningRooms = new Map<string, LightRun>();

export function register(roomId: string, opts: { workspacePath?: string } = {}): void {
  runningRooms.set(roomId, { cancelled: false, workspacePath: opts.workspacePath });
  logger.debug(`[LightRegistry] register room=${roomId} (total: ${runningRooms.size})`);
}

export function unregister(roomId: string): void {
  if (runningRooms.delete(roomId)) {
    logger.debug(`[LightRegistry] unregister room=${roomId} (total: ${runningRooms.size})`);
  }
}

export function isRunning(roomId: string): boolean {
  return runningRooms.has(roomId);
}

/**
 * 走行中の処理が「もう捨ててよいか」を判定する。
 * 未 register (= 走っていない) は false。unregister すると flag ごと消えるので、
 * 次の run が前回の中断を引き継ぐことはない。
 */
export function isCancelled(roomId: string): boolean {
  return runningRooms.get(roomId)?.cancelled === true;
}

export function cancel(roomId: string): CancelResult {
  const run = runningRooms.get(roomId);
  if (!run) return { success: true, was_running: false };

  run.cancelled = true;
  // codex SDK の子プロセス (codex.exe / launcher の node.exe) を workspace path 一致で落とす。
  // workspace_path は WORKSPACE_ROOT/<agentId>/<roomId> (context/sessionManager.mts) なので
  // room-unique = 他ルームを巻き込まない。
  sweepByWorkspacePath(run.workspacePath, roomId);
  logger.info(`[LightRegistry] cancelled room=${roomId} workspace=${run.workspacePath || '?'}`);
  return { success: true, was_running: true };
}
