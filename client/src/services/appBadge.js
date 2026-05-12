/**
 * App Badge (PWA ホーム画面アイコンの未読数バッジ) — Badging API ラッパー
 *
 * iOS Safari 16.4+ (PWA installed) / Chrome / Edge 81+ で対応。
 * Firefox は未対応 (silent fail で OK)。
 *
 * 二経路で更新:
 *   1. foreground: Socket.IO `message:new` → roomStore.fetchRooms → syncBadgeFromRooms
 *   2. background: Service Worker push event → navigator.setAppBadge (custom-sw.js)
 */

export function setBadge(count) {
  if (typeof navigator === 'undefined') return;
  if (!('setAppBadge' in navigator)) return;
  try {
    if (count && count > 0) {
      navigator.setAppBadge(count).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  } catch {
    // Badging API 例外は silent fail (非対応 / 権限なし等)
  }
}

export function syncBadgeFromRooms(rooms) {
  const total = (rooms || []).reduce((sum, r) => sum + (Number(r.unread_count) || 0), 0);
  setBadge(total);
}
