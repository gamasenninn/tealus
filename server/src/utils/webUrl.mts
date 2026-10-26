/**
 * 画面で開く URL (部屋のアプリ app_urls・ホームのリンク portal_links) は http / https だけを受け付ける
 * (セキュリティチェックループ 2 回目、2026-10-26)。★ 画面の入力欄は形を見るだけなので、本体で見る
 */
export function isWebUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** app_urls は { url: http(s) } の配列。空の配列 (全部消す) は通す */
export function isValidAppUrls(value: unknown): boolean {
  return Array.isArray(value) && value.every(a => a !== null && typeof a === 'object' && isWebUrl((a as { url?: unknown }).url));
}
