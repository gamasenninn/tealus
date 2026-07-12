/**
 * 委譲チェーン: 予算付き封筒 + 4 段ガード (#295)
 *
 * room 間委譲 (`%<room> <task>`) の安全装置。悪意ある無限増殖を「メカニズム側」で止める。
 *
 * 肝: agent は `%` 平文を吐くだけで封筒に触れない。封筒 (chainId / 予算 / visited / hop) は
 * このモジュールが生成・伝播する。よって悪意ある指示が agent に大量の `%` を吐かせても、
 * それらは全て同じ chainId を継承し同じ共有予算 K を食い潰すだけで、新しい予算を捏造できない。
 * → LLM の自制に頼らず決定的レイヤーで強制 (#292 throttle は別途 backstop)。
 *
 * 4 段ガード:
 *   1. budget (chain 全体の委譲総数 ≤ maxChainBudget) ← 扇状増殖の本命対策、木の形に依らない
 *   2. max_depth (hop ≤ maxDepth)                    ← 直線深掘り
 *   3. cycle (visited 既出 room へは委譲しない)        ← 循環 A→B→A
 *   4. fanout (1 parent からの分岐 ≤ maxFanoutPerTurn) ← 1 応答での多段分岐
 *
 * 封筒 (envelope): { chainId, nodeId, hop, visited:[roomId...], originRoomId, targetRoomId, task }
 */
import crypto from 'node:crypto';

interface ChainLimits {
  maxDepth: number;
  maxChainBudget: number;
  maxFanoutPerTurn: number;
}

interface Envelope {
  chainId: string;
  nodeId: string;
  hop: number;
  visited: string[];
  originRoomId: string;
  targetRoomId: string;
  task: string;
}

type ChainResult = { ok: true; envelope: Envelope } | { ok: false; reason: string };

const DEFAULT_LIMITS: ChainLimits = Object.freeze({
  maxDepth: 5,
  maxChainBudget: 20,
  maxFanoutPerTurn: 3,
});

let limits: ChainLimits = { ...DEFAULT_LIMITS };

// chainId → これまでに消費した委譲数 (root 委譲を 1 と数える)
const chainSpent = new Map<string, number>();
// parent nodeId → その parent から分岐した子委譲数
const nodeFanout = new Map<string, number>();

function configure(newLimits: Partial<ChainLimits> = {}): void {
  limits = { ...DEFAULT_LIMITS, ...newLimits };
}

function _reset(): void {
  chainSpent.clear();
  nodeFanout.clear();
}

/**
 * human 起点の root 委譲。新 chain を採番し封筒を生成、共有予算を 1 消費する。
 */
function startChain({ originRoomId, targetRoomId, task }: { originRoomId: string; targetRoomId: string; task: string }): ChainResult {
  // 自室委譲は visited=[origin] への一致 = cycle として弾く
  if (targetRoomId === originRoomId) {
    return { ok: false, reason: 'cycle' };
  }
  const chainId = crypto.randomUUID();
  chainSpent.set(chainId, 1);
  const envelope: Envelope = {
    chainId,
    nodeId: crypto.randomUUID(),
    hop: 0,
    visited: [originRoomId, targetRoomId],
    originRoomId,
    targetRoomId,
    task,
  };
  return { ok: true, envelope };
}

/**
 * chain 内の子委譲 (agent が `%` を吐いた場合)。4 段ガードを通れば子封筒を返し共有予算を 1 消費。
 */
function extendChain(parent: Envelope, { targetRoomId, task }: { targetRoomId: string; task: string }): ChainResult {
  if (!parent || !chainSpent.has(parent.chainId)) {
    // 偽造封筒 / reset 後の孤児 → 予算を捏造させない
    return { ok: false, reason: 'unknown_chain' };
  }

  // 1. cycle
  if (parent.visited.includes(targetRoomId)) {
    return { ok: false, reason: 'cycle' };
  }
  // 2. max_depth
  if (parent.hop + 1 > limits.maxDepth) {
    return { ok: false, reason: 'max_depth' };
  }
  // 3. fanout (同一 parent からの分岐数)
  if ((nodeFanout.get(parent.nodeId) || 0) >= limits.maxFanoutPerTurn) {
    return { ok: false, reason: 'fanout_exceeded' };
  }
  // 4. budget (chain 全体)
  if ((chainSpent.get(parent.chainId) as number) >= limits.maxChainBudget) {
    return { ok: false, reason: 'budget_exhausted' };
  }

  // 消費
  nodeFanout.set(parent.nodeId, (nodeFanout.get(parent.nodeId) || 0) + 1);
  chainSpent.set(parent.chainId, (chainSpent.get(parent.chainId) as number) + 1);

  const envelope: Envelope = {
    chainId: parent.chainId,
    nodeId: crypto.randomUUID(),
    hop: parent.hop + 1,
    visited: [...parent.visited, targetRoomId],
    originRoomId: parent.originRoomId,
    targetRoomId,
    task,
  };
  return { ok: true, envelope };
}

export { startChain, extendChain, configure, _reset, DEFAULT_LIMITS };
