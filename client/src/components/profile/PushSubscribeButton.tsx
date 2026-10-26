import { useEffect, useState } from 'react';
import { getPushState, refreshPushSubscription, registerPushNotification } from '../../services/pushNotification';
import type { PushState } from '../../services/pushNotification';

/**
 * #546 この端末にプッシュの宛先が無いとき、タップで登録し直す。
 * ★ iPhone は利用者のタップなしでは宛先を作れない。起動時の自動登録が通らなかった端末の戻し道
 */
const SLOW_HINT_MS = 8000;
const SLOW_HINT = '「通知を許可しますか」が出ていなければ、アドレスバーの右の小さなベルの印を押して「許可」してください。'
  + 'ベルの印が無いときは、アドレスバーの左の印 → サイトの設定 → 通知 → 「許可」にして、画面を読み込み直してからもう一度押してください。';

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
    // ★ 2026-10-26: 答えが返らないまま何も言わずに止まっていた (Chrome が許可の問いを目立たない形にすると、押しても何も出ない)
    const slow = setTimeout(() => setNote(SLOW_HINT), SLOW_HINT_MS);
    const result = await registerPushNotification();
    clearTimeout(slow);
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
