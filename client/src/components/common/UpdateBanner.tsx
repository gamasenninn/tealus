import { useVersionCheck } from '../../hooks/useVersionCheck';
import { resetAppCache } from '../../services/resetAppCache';
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
    // caches / serviceWorker が無い環境でも必ず reload に到達させる (#356)。
    // ★ #528 #546 SW を消す前に今の宛先を覚える。読み込み直した画面が古い宛先を本体から外す (resetAppCache の中)
    await resetAppCache();
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
