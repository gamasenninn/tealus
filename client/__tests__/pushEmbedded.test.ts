/**
 * #509 マルチトークの各パネル (同じオリジンの iframe) が、それぞれ通知の購読を作っていた
 *
 * 購読が無い状態で開くと、親と各パネルが同時に subscribe() を呼び、送り先が同時に何本もできる
 * (本番で同じ分に 5〜9 本。生き残るのは 1 本で、残りは送ったときに 410 で弾かれる)。
 * 購読は端末に 1 本でよいので、親が同じ Tealus のパネルの中では登録しない。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.fn();
const subscribePush = vi.fn();
let embedded = false;
vi.mock('../src/utils/embedded', async (orig) => ({
  ...(await orig<typeof import('../src/utils/embedded')>()),
  isEmbeddedInSameApp: () => embedded,
}));
vi.mock('../src/services/api', () => ({ api: { subscribePush: (b: unknown) => subscribePush(b) } }));
vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: 'AAAA' }) }));

describe('registerPushNotification — パネルの中では登録しない (#509)', () => {
  beforeEach(() => {
    subscribe.mockReset();
    subscribePush.mockReset().mockResolvedValue({});
    const sub = { endpoint: 'https://fcm.example/x', getKey: () => new Uint8Array([1]).buffer };
    subscribe.mockResolvedValue(sub);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe } }) },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  });

  it('★★ パネルの中では購読を作らず、サーバーにも送らない', async () => {
    embedded = true;
    const { registerPushNotification } = await import('../src/services/pushNotification');
    await registerPushNotification();
    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it('パネルの外では今までどおり登録する', async () => {
    embedded = false;
    const { registerPushNotification } = await import('../src/services/pushNotification');
    await registerPushNotification();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribePush).toHaveBeenCalledTimes(1);
  });
});
