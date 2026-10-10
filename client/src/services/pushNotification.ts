import { api } from './api';
import { getConfig } from './clientConfig';
import { deviceLabel } from '../utils/deviceLabel';
import { isEmbeddedInSameApp } from '../utils/embedded';
import { reportClientError } from './errorReport';

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

/**
 * #546 更新・キャッシュクリアの前の宛先 (resetAppCache が覚え、読み込み直した画面の registerPushNotification が片づける)。
 * ★ ブラウザの宛先は外さない。iPhone は利用者のタップなしでは宛先を作り直せない (#528 の初版で通知が届かなくなった)
 */
export const PREV_ENDPOINT_KEY = 'tealus:push:prevEndpoint';

export async function rememberCurrentEndpoint(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) localStorage.setItem(PREV_ENDPOINT_KEY, subscription.endpoint);
  } catch (err) {
    console.warn('[push] remember endpoint failed:', err);
  }
}

/** 登録できたあとで、更新の前の宛先が今と違えば本体から外す (#528 古い行を溜めない) */
async function forgetPreviousEndpoint(current: string): Promise<void> {
  let prev: string | null = null;
  try { prev = localStorage.getItem(PREV_ENDPOINT_KEY); } catch { return; }
  if (!prev) return;
  if (prev !== current) {
    try { await api.unsubscribePush(prev); } catch (err) { console.warn('[push] old endpoint unsubscribe failed:', err); return; }
  }
  try { localStorage.removeItem(PREV_ENDPOINT_KEY); } catch { /* 次の登録で片づける */ }
}

export type PushRegisterResult = 'ok' | 'denied' | 'unsupported' | 'failed';
export type PushState = 'subscribed' | 'none' | 'unsupported';

/** #546 この端末に宛先があるか (プロフィールの「この端末で通知を受け取る」の出し分け) */
export async function getPushState(): Promise<PushState> {
  if (isEmbeddedInSameApp()) return 'unsupported';
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker || !('PushManager' in window)) return 'unsupported';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription ? 'subscribed' : 'none';
  } catch {
    return 'unsupported';
  }
}

export async function registerPushNotification(): Promise<PushRegisterResult> {
  // ★ #509 マルチトークのパネルの中では登録しない。購読は端末に 1 本でよく (親が持つ)、
  //   パネルごとに同時に subscribe() すると送り先が何本もでき、生き残る 1 本以外は送ったときに 410 で弾かれていた
  if (isEmbeddedInSameApp()) return 'unsupported';
  const VAPID_PUBLIC_KEY = getConfig().vapid_public_key;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[push] vapid_public_key not provided by /api/config');
    return 'unsupported';
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[push] Push notifications not supported');
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return 'denied';
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
    await forgetPreviousEndpoint(subscription.endpoint);
    return 'ok';
  } catch (err) {
    console.error('[push] Registration failed:', err);
    // ★ #546 以前は端末の中にしか残らず、通知が届かなくなっても誰も気づけなかった
    reportClientError('error', err, 'push: registerPushNotification');
    return 'failed';
  }
}
