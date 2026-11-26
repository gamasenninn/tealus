/**
 * 件数 (limit) と飛ばす数 (offset) の読み方 (#664)。
 * ★ 道ごとに parseInt を書いていて、数でない値 (NaN) や負の数がそのまま SQL に渡り 500 になる道があった
 *   (お知らせ・ギャラリー・タグ一覧)。ここに 1 つ置く
 * - 無い・数でない・0 → 既定。負の数 → 1。上限を超える → 上限
 */
export function parseLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  return Math.min(Math.max(parseInt(String(value)) || defaultLimit, 1), maxLimit);
}

/** 無い・数でない・負の数 → 0 */
export function parseOffset(value: unknown): number {
  return Math.max(parseInt(String(value)) || 0, 0);
}
