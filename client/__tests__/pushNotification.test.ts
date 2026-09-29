/**
 * 通知の登録に端末名を付けて送る (2026-09-29)
 * ★ 以前は device_name を送っておらず、登録がどの端末のものか見分けられなかった
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribePush = vi.fn();
vi.mock('../src/services/api', () => ({ api: { subscribePush: (b: unknown) => subscribePush(b) } }));
vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: 'AAAA' }) }));

import { registerPushNotification } from '../src/services/pushNotification';

describe('registerPushNotification — 端末名を付けて送る', () => {
  beforeEach(() => {
    subscribePush.mockReset().mockResolvedValue({});
    const sub = { endpoint: 'https://fcm.example/x', getKey: () => new Uint8Array([1, 2, 3]).buffer };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => sub, subscribe: async () => sub } }) },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 17; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
    });
  });

  it('★ ブラウザで開いているとき', async () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
    await registerPushNotification();
    expect(subscribePush).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://fcm.example/x', device_name: 'Android Chrome',
    }));
  });

  it('★ ホーム画面のアプリとして開いているとき', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    await registerPushNotification();
    expect(subscribePush.mock.calls[0][0]).toMatchObject({ device_name: 'Android Chrome (アプリ)' });
  });
});
