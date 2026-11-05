import { useState } from 'react';
import { isIosBrowserTab, pushPermission, registerPushNotification } from '../../services/pushNotification';
import { getConfig } from '../../services/clientConfig';
import './PushOnboardingBanner.css';

const DISMISS_KEY = 'pushOnboardingDismissed';

function dismissedThisSession(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

/**
 * 初めての人への通知の案内 (2026-10-29 小野さん判断 6)。
 *
 * ★ 以前はログインした瞬間に説明なしでブラウザの許可の問いが出て、初めての人は何の許可か分からずブロックしやすかった。
 *   まだ聞いていない端末では先に 1 行で説明し、押したときだけ許可を求める (iPhone はタップの中でしか求められないので、こちらの方が通る)。
 * ★ iPhone の Safari (ホーム画面から開いていない) では通知が届かないので、ホーム画面に追加を案内する。
 * ★ 「あとで」はこの起動のあいだだけ閉じる。プロフィールの「この端末で通知を受け取る」(#546) はいつでも使える
 */
function PushOnboardingBanner({ activeSubscriptions = null }: {
  /**
   * 本体が数えた有効な通知の宛先の本数 (改善ループ 40)。★ 0 なら許可の状態に関係なく案内する。
   *   11-03 に iPhone の宛先が 410 で外れた人は許可済みのままで、「まだ聞いていない端末」だけを案内する作りでは何も出ず、
   *   2 日で 195 件の通知が届かなかった。null (分からない) は今までどおり
   */
  activeSubscriptions?: number | null;
}) {
  const [hidden, setHidden] = useState(dismissedThisSession);
  if (hidden) return null;
  // ★ 通知の鍵 (VAPID) の無い Tealus では何も出さない。iPhone の案内どおりにしても届かない (0c7fbd8 のボタンと同じ判断)
  if (!getConfig().vapid_public_key) return null;

  const close = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* 閉じるだけはする */ }
    setHidden(true);
  };

  if (isIosBrowserTab()) {
    return (
      <div className="push-onboarding" role="status">
        <span className="push-onboarding-text">iPhone で通知を受け取るには、共有ボタン (□↑) →「ホーム画面に追加」から Tealus を開いてください</span>
        <button className="push-onboarding-btn secondary" onClick={close}>閉じる</button>
      </div>
    );
  }

  const enable = () => {
    setHidden(true);
    void registerPushNotification();
  };

  const permission = pushPermission();
  if (activeSubscriptions === 0 && permission === 'granted') {
    // ★ iPhone は宛先を捨てても許可は残る。作り直すにはタップの中で頼む必要がある (#546)
    return (
      <div className="push-onboarding" role="status">
        <span className="push-onboarding-text">この端末に通知が届いていません。押すと受け取れるようにします</span>
        <button className="push-onboarding-btn" onClick={enable}>通知を受け取る</button>
        <button className="push-onboarding-btn secondary" onClick={close}>あとで</button>
      </div>
    );
  }
  if (activeSubscriptions === 0 && permission === 'denied') {
    return (
      <div className="push-onboarding" role="status">
        <span className="push-onboarding-text">通知が切れているので、メッセージが届いても知らせが出ません。端末の設定で Tealus の通知を「許可」にしてから開き直してください</span>
        <button className="push-onboarding-btn secondary" onClick={close}>閉じる</button>
      </div>
    );
  }

  if (permission !== 'default') return null;

  return (
    <div className="push-onboarding" role="status">
      <span className="push-onboarding-text">メッセージが届いたときに通知を受け取れます。押すと確認が出るので「許可」を選んでください</span>
      <button className="push-onboarding-btn" onClick={enable}>通知を受け取る</button>
      <button className="push-onboarding-btn secondary" onClick={close}>あとで</button>
    </div>
  );
}

export default PushOnboardingBanner;
