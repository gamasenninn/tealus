import { useEffect, useState } from 'react';
import { getPushState, registerPushNotification } from '../../services/pushNotification';
import type { PushState } from '../../services/pushNotification';

/**
 * #546 この端末にプッシュの宛先が無いとき、タップで登録し直す。
 * ★ iPhone は利用者のタップなしでは宛先を作れない。起動時の自動登録が通らなかった端末の戻し道
 */
function PushSubscribeButton() {
  const [state, setState] = useState<PushState | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getPushState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  if (state === null || state === 'unsupported') return null;
  if (state === 'subscribed') return <p className="profile-hint">この端末は通知を受け取れます。</p>;

  const onClick = async () => {
    setBusy(true);
    setNote('');
    const result = await registerPushNotification();
    setBusy(false);
    if (result === 'ok') setState('subscribed');
    else if (result === 'denied') setNote('通知が許可されていません。端末の設定で Tealus の通知を許可してから、もう一度押してください。');
    else setNote('登録できませんでした。少し待ってから、もう一度押してください。');
  };

  return (
    <div>
      <p className="profile-hint">この端末には通知の宛先がありません (通知が届きません)。</p>
      <button type="button" className="profile-save-btn" onClick={onClick} disabled={busy}>この端末で通知を受け取る</button>
      {note && <p className="profile-hint">{note}</p>}
    </div>
  );
}

export default PushSubscribeButton;
