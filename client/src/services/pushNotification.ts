import { api } from './api';
import { getConfig } from './clientConfig';
import { deviceLabel } from '../utils/deviceLabel';
import { isEmbeddedInSameApp } from '../utils/embedded';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * #508 この端末の購読を外す (ログアウトのとき)。
 * ★ 外さないと、ログアウトした端末にもその人宛ての通知 (本文の先頭つき) が届き続けていた。
 * ★ サーバーへの取り消しは認証が要るので、トークンを消す前に呼ぶこと。失敗しても例外は外へ出さない
 */
export async function unregisterPushNotification(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    try {
      await api.unsubscribePush(subscription.endpoint);
    } catch (err) {
      console.warn('[push] server unsubscribe failed:', err);
    }
    await subscription.unsubscribe();
  } catch (err) {
    console.warn('[push] unsubscribe failed:', err);
  }
}

export async function registerPushNotification(): Promise<void> {
  // ★ #509 マルチトークのパネルの中では登録しない。購読は端末に 1 本でよく (親が持つ)、
  //   パネルごとに同時に subscribe() すると送り先が何本もでき、生き残る 1 本以外は送ったときに 410 で弾かれていた
  if (isEmbeddedInSameApp()) return;
  const VAPID_PUBLIC_KEY = getConfig().vapid_public_key;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[push] vapid_public_key not provided by /api/config');
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[push] Push notifications not supported');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const p256dh = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh')!)));
    const auth = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth')!)));

    // 端末名を付ける (2026-09-29)。以前は送っておらず、登録がどの端末のものか見分けられなかった
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    await api.subscribePush({
      endpoint: subscription.endpoint,
      p256dh_key: p256dh,
      auth_key: auth,
      device_name: deviceLabel(navigator.userAgent, standalone),
    });
  } catch (err) {
    console.error('[push] Registration failed:', err);
  }
}
