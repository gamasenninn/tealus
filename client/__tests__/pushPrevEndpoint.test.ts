/**
 * #546 更新のあと、読み込み直した画面が宛先を登録し直したら、古い宛先だけを本体から外す。
 * ★ #528 の初版は更新の前にブラウザの宛先まで外していた。iPhone は利用者のタップなしでは作り直せず、通知が届かなくなった
 * ★ 登録に失敗したら古い行は残す (残っていれば届く端末がある)・失敗は本体のログへ (#525)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribePush = vi.fn();
const unsubscribePush = vi.fn();
const reportClientError = vi.fn();
vi.mock('../src/services/api', () => ({
  api: { subscribePush: (b: unknown) => subscribePush(b), unsubscribePush: (e: string) => unsubscribePush(e) },
}));
vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: 'AAAA' }) }));
vi.mock('../src/services/errorReport', () => ({ reportClientError: (...a: unknown[]) => reportClientError(...a) }));

import { registerPushNotification, PREV_ENDPOINT_KEY } from '../src/services/pushNotification';

function stub({ existing = true, subscribeFails = false } = {}) {
  const sub = { endpoint: 'https://push.example/new', getKey: () => new Uint8Array([1, 2, 3]).buffer };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => (existing ? sub : null),
      subscribe: async () => { if (subscribeFails) throw new Error('user gesture required'); return sub; },
    } }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'granted' } });
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
}

describe('registerPushNotification — 古い宛先の片づけ (#546)', () => {
  beforeEach(() => {
    subscribePush.mockReset().mockResolvedValue({});
    unsubscribePush.mockReset().mockResolvedValue({});
    reportClientError.mockReset();
    localStorage.clear();
  });

  it('★ 登録できて宛先が変わっていたら、古い宛先を本体から外して覚えを消す', async () => {
    stub();
    localStorage.setItem(PREV_ENDPOINT_KEY, 'https://push.example/old');
    await expect(registerPushNotification()).resolves.toBe('ok');
    expect(unsubscribePush).toHaveBeenCalledWith('https://push.example/old');
    expect(localStorage.getItem(PREV_ENDPOINT_KEY)).toBeNull();
  });

  it('★ 宛先が同じなら外さない (iPhone では更新しても同じ宛先が残る)', async () => {
    stub();
    localStorage.setItem(PREV_ENDPOINT_KEY, 'https://push.example/new');
    await registerPushNotification();
    expect(unsubscribePush).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREV_ENDPOINT_KEY)).toBeNull();
  });

  it('★★ 宛先を作れなかったら古い行は残し、失敗を本体のログへ送る', async () => {
    stub({ existing: false, subscribeFails: true });
    localStorage.setItem(PREV_ENDPOINT_KEY, 'https://push.example/old');
    await expect(registerPushNotification()).resolves.toBe('failed');
    expect(unsubscribePush).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREV_ENDPOINT_KEY)).toBe('https://push.example/old');
    expect(reportClientError).toHaveBeenCalledWith('error', expect.anything(), expect.stringContaining('push'));
  });

  it('許可されなかったら denied を返す (ボタンの表示に使う)', async () => {
    stub();
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'denied' } });
    await expect(registerPushNotification()).resolves.toBe('denied');
    expect(subscribePush).not.toHaveBeenCalled();
  });
});

describe('getPushState (#546)', () => {
  it('宛先があれば subscribed、無ければ none', async () => {
    const { getPushState } = await import('../src/services/pushNotification');
    stub({ existing: true });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => ({ endpoint: 'x' }) } }) } });
    await expect(getPushState()).resolves.toBe('subscribed');
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }) } });
    await expect(getPushState()).resolves.toBe('none');
  });
});
