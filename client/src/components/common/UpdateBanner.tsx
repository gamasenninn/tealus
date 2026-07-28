import { useVersionCheck } from '../../hooks/useVersionCheck';
import './UpdateBanner.css';

/**
 * #356 「新しいバージョンがあります」バナー。
 *
 * iOS の standalone PWA は Service Worker の更新チェックが不発になりがちで、
 * precache から古い画面を返し続ける。SW を通らない `GET /api/version` で自力で気づき、
 * ユーザーの操作で確実に載せ替える。
 */
function UpdateBanner() {
  const { updateAvailable } = useVersionCheck();

  if (!updateAvailable) return null;

  const reload = async () => {
    // 古い precache を捨ててから読み直す。ここを飛ばすと SW が再び古い版を返す。
    // caches / serviceWorker が無い環境でも必ず reload に到達させる (#356)
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch { /* 消せなくても reload は行う */ }
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs || []).map(r => r.unregister()));
    } catch { /* 同上 */ }
    location.reload();
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">新しいバージョンがあります</span>
      <button className="update-banner-btn" onClick={reload}>再読み込み</button>
    </div>
  );
}

export default UpdateBanner;
