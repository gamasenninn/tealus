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

const optional = (v: unknown, type: 'string' | 'boolean') => v === undefined || v === null || typeof v === type;

/**
 * app_urls は { url: http(s), title?: 文字, ratio?: 数, auto_open / wake_lock / pass?: true/false } の配列。空の配列 (全部消す) は通す。
 * ★ 見出し (title) に文字以外が入ると、その部屋を開いた全員の画面が落ちる (セキュリティチェックループ 3 回目)
 */
export function isValidAppUrls(value: unknown): boolean {
  return Array.isArray(value) && value.every(a => {
    if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
    const o = a as Record<string, unknown>;
    return isWebUrl(o.url)
      && optional(o.title, 'string')
      && (o.ratio === undefined || o.ratio === null || (typeof o.ratio === 'number' && Number.isFinite(o.ratio)))
      && optional(o.auto_open, 'boolean') && optional(o.wake_lock, 'boolean') && optional(o.pass, 'boolean');
  });
}
