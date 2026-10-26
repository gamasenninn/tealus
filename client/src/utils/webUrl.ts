/** 画面で開く URL は http / https だけ (セキュリティチェックループ 2 回目、2026-10-26。本体の server/src/utils/webUrl.mts と同じ決まり) */
export function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
