import { useEffect, useState } from 'react';
import { getPushState, refreshPushSubscription, registerPushNotification } from '../../services/pushNotification';
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
  // ★ 2026-10-16: 「受け取れます」と言い切らない。端末に宛先があっても、本体は 30 日送り直されない宛先を外す
  //   (送り直しは画面が表に出たときに自動で行う)。届かないときの戻し道として「登録し直す」を出す
  if (state === 'subscribed') {
    const onResend = async () => {
      setBusy(true);
      setNote('');
      const sent = await refreshPushSubscription(Date.now(), { force: true });
      setBusy(false);
      setNote(sent ? '送り直しました。' : '送り直せませんでした。少し待ってから、もう一度押してください。');
    };
    return (
      <div>
        <p className="profile-hint">この端末には通知の宛先があります。通知が届かないときは「登録し直す」を押してください。</p>
        <button type="button" className="profile-save-btn" onClick={onResend} disabled={busy}>登録し直す</button>
        {note && <p className="profile-hint">{note}</p>}
      </div>
    );
  }

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
