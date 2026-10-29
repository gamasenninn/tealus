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
export async function unregisterPushNotification({ server = true }: { server?: boolean } = {}): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    // ★ server: false = 鍵が切れたあと (2026-10-29)。切れた鍵で頼んでも 401 になるだけ (14 日で 8 回)。
    //   本体の死んだ宛先は、送ったときの 410 か 30 日の掃除で片づく
    if (server) {
      try {
        await api.unsubscribePush(subscription.endpoint);
      } catch (err) {
        console.warn('[push] server unsubscribe failed:', err);
      }
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

/**
 * この端末の通知の許可 (2026-10-29)。'default' = まだ聞いていない。通知を使えない・パネルの中・鍵が無いなら 'unsupported'
 * ★ ログインや起動で黙って登録してよいのは 'granted' のときだけ。'default' は案内 (PushOnboardingBanner) を出して、押したときに聞く
 */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (isEmbeddedInSameApp()) return 'unsupported';
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (!getConfig().vapid_public_key) return 'unsupported';   // ★ 鍵の無い Tealus (採用者) では聞かない
  return Notification.permission;
}

/** iPhone / iPad の Safari で、ホーム画面から開いていない (= 通知が届かない) */
export function isIosBrowserTab(): boolean {
  if (isEmbeddedInSameApp()) return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export type PushRegisterResult = 'ok' | 'denied' | 'unsupported' | 'failed';
export type PushState = 'subscribed' | 'none' | 'unsupported';

/** #546 この端末に宛先があるか (プロフィールの「この端末で通知を受け取る」の出し分け) */
export async function getPushState(): Promise<PushState> {
  if (isEmbeddedInSameApp()) return 'unsupported';
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker || !('PushManager' in window)) return 'unsupported';
  // ★ 鍵の無い Tealus (採用者) では出さない (2026-10-29)。押すたびに「もう一度押して」と出て、待っても直らなかった
  if (!getConfig().vapid_public_key) return 'unsupported';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription ? 'subscribed' : 'none';
  } catch {
    return 'unsupported';
  }
}

/** 宛先を本体へ送る (登録と送り直しで共通)。本体は同じ宛先なら「最後に送り直した時刻」を進め、外されていれば戻す */
async function sendSubscription(subscription: PushSubscription): Promise<void> {
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
}

export const PUSH_REFRESH_KEY = 'tealus:push:refreshedAt';
const PUSH_REFRESH_ENDPOINT_KEY = 'tealus:push:refreshedEndpoint';
const PUSH_REFRESH_INTERVAL_MS = 6 * 3_600_000;

/**
 * 画面が表に出たときに宛先を送り直す (2026-10-16、改善ループ 7 回目の 3)。
 *
 * ★ 送り直しはログインと最初の読み込みのときだけで、iPhone のアプリのように裏に残ったまま再開すると送らなかった
 *   (10-10 に読んでいる人の宛先が 09-27 のまま)。本体は 30 日送り直されない宛先を外すので、使っている端末は送り直す。
 * ★★ 許可を求めない・新しい宛先を作らない。許可済みで宛先がすでにあるときだけ (画面に戻るたびに確認が出ないように)。
 * ★ 6 時間に 1 回まで。送れなかったら時刻を進めない。端末の保存領域が使えなくても送る (間引けないだけ)。
 * @returns 送ったか
 */
export async function refreshPushSubscription(now = Date.now(), opts: { force?: boolean } = {}): Promise<boolean> {
  if (isEmbeddedInSameApp()) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker || !('PushManager' in window)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return false;
    if (!opts.force) {
      // ★ 記録が無い (初めて・保存領域が使えない) ときは「まだ送っていない」= 送る
      // ★ 宛先が前回と変わっていたら間引かない (改善ループ 18 回目)。ブラウザが差し替えても (pushsubscriptionchange、
      //   custom-sw.js では受けていない)、時刻だけを見て最長 6 時間送らなかった
      let last: number | null = null;
      let lastEndpoint: string | null = null;
      try {
        const v = localStorage.getItem(PUSH_REFRESH_KEY);
        if (v !== null && Number.isFinite(Number(v))) last = Number(v);
        lastEndpoint = localStorage.getItem(PUSH_REFRESH_ENDPOINT_KEY);
      } catch { /* 間引けないだけ */ }
      if (last !== null && now - last < PUSH_REFRESH_INTERVAL_MS && lastEndpoint === subscription.endpoint) return false;
    }
    await sendSubscription(subscription);
    try {
      localStorage.setItem(PUSH_REFRESH_KEY, String(now));
      localStorage.setItem(PUSH_REFRESH_ENDPOINT_KEY, subscription.endpoint);
    } catch { /* 間引けないだけ */ }
    return true;
  } catch {
    return false;
  }
}

let resumeListening = false;
/** 画面が表に出るたびに refreshPushSubscription を呼ぶ (ログイン後に 1 回だけ張る) */
export function startPushResumeRefresh(): void {
  if (resumeListening || typeof document === 'undefined') return;
  resumeListening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPushSubscription();
  });
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

    await sendSubscription(subscription);
    await forgetPreviousEndpoint(subscription.endpoint);
    return 'ok';
  } catch (err) {
    console.error('[push] Registration failed:', err);
    // ★ #546 以前は端末の中にしか残らず、通知が届かなくなっても誰も気づけなかった
    reportClientError('error', err, 'push: registerPushNotification');
    return 'failed';
  }
}
