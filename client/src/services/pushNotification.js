import { api } from './api';
import { getConfig } from './clientConfig';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPushNotification() {
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
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const p256dh = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('p256dh'))));
    const auth = btoa(String.fromCharCode(...new Uint8Array(subscription.getKey('auth'))));

    await api.subscribePush({
      endpoint: subscription.endpoint,
      p256dh_key: p256dh,
      auth_key: auth,
    });
  } catch (err) {
    console.error('[push] Registration failed:', err);
  }
}
