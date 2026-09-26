/**
 * Service Worker が横取りしない URL (vite.config.js の navigateFallbackDenylist)。
 * ★ テスト (__tests__/pwaDenylist.test.ts) と共有するため、設定ファイルから切り出してある (2026-09-26)。
 *
 * ★ `/system` は (\/|$) で終わりまで見る —— `/^\/system\//` だとスラッシュ無しの `/system` を SW が横取りし、
 *   本体アプリのホームに飛ばしていた (サーバは 301 で /system/ に送るのに、そこまで届かなかった)。
 */
export const NAVIGATE_FALLBACK_DENYLIST = [
  /^\/media\//,
  /^\/api\//,
  /^\/system(\/|$)/,
  /^\/agent-api\//,
  /^\/rtc\//,
  /^\/mcp\//,
];
