/**
 * #545 % 委譲の待ち合い (デッドロック) を避ける。
 *
 * ★ 委譲は依頼元の部屋の列の中から、相手の部屋の列に並んで答えを待つ (dispatcher.mts の runAgent)。
 *   A が B を待っている間に B が A を待つと、互いを待ったまま QUEUE_TASK_TIMEOUT (540 秒) まで
 *   「問い合わせ中...」のままだった (2026-10-09 の点検、30 日で 0 件だが起きうる形)
 * ★ 「どの部屋がどの部屋の答えを待っているか」を覚え、頼む相手からたどって依頼元に戻るなら並ばずに断る。
 *   本体は 1 プロセスなので、メモリに持てば足りる
 */

// 待っている部屋 → (待っている相手 → 件数)
const waits = new Map<string, Map<string, number>>();

/** target からたどって origin に着くか (= 並ぶと輪になる) */
function reaches(from: string, to: string, seen = new Set<string>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const next of waits.get(from)?.keys() ?? []) {
    if (reaches(next, to, seen)) return true;
  }
  return false;
}

/**
 * origin が target の答えを待ち始める。輪になるなら false (並ばずに断る)。
 * true を返したら、終わったときに必ず endWait を呼ぶこと
 */
export function beginWait(origin: string, target: string): boolean {
  if (reaches(target, origin)) return false;
  const m = waits.get(origin) ?? new Map<string, number>();
  m.set(target, (m.get(target) ?? 0) + 1);
  waits.set(origin, m);
  return true;
}

export function endWait(origin: string, target: string): void {
  const m = waits.get(origin);
  if (!m) return;
  const n = (m.get(target) ?? 0) - 1;
  if (n > 0) m.set(target, n); else m.delete(target);
  if (m.size === 0) waits.delete(origin);
}

/** テスト用 */
export function _resetWaits(): void { waits.clear(); }
