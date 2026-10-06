/**
 * #508 ログアウトしても、その端末にプッシュ通知が届き続けていた
 *
 * logout はトークンとソケットを片付けるだけで、通知の購読を外していなかった。
 * 外す口 (DELETE /api/push/subscribe) はあったが、どこからも呼んでいなかった。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const order: string[] = [];
const unsubscribePush = vi.fn();
const setToken = vi.fn((t: string | null) => { order.push(`setToken:${t}`); });
vi.mock('../src/services/api', () => ({ api: {
  unsubscribePush: (e: string) => { order.push('api.unsubscribePush'); return unsubscribePush(e); },
  setToken: (t: string | null) => setToken(t),
} }));
vi.mock('../src/services/clientConfig', () => ({ getConfig: () => ({ vapid_public_key: 'AAAA' }) }));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));

import { unregisterPushNotification } from '../src/services/pushNotification';
import { useAuthStore } from '../src/stores/authStore';

let sub: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null;
const setSW = (value: unknown) => Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });

describe('unregisterPushNotification — 購読を外す (#508)', () => {
  beforeEach(() => {
    order.length = 0;
    unsubscribePush.mockReset().mockResolvedValue({});
    sub = { endpoint: 'https://fcm.example/x', unsubscribe: vi.fn(async () => { order.push('sub.unsubscribe'); return true; }) };
    setSW({ getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) });
  });

  it('★ サーバーとブラウザの両方から外す', async () => {
    await unregisterPushNotification();
    expect(unsubscribePush).toHaveBeenCalledWith('https://fcm.example/x');
    expect(sub!.unsubscribe).toHaveBeenCalled();
  });

  it('★ サーバーへの通知に失敗しても、ブラウザ側は外す (例外を外へ出さない)', async () => {
    unsubscribePush.mockRejectedValue(new Error('offline'));
    await expect(unregisterPushNotification()).resolves.toBeUndefined();
    expect(sub!.unsubscribe).toHaveBeenCalled();
  });

  it('購読が無ければ何もしない', async () => {
    sub = null;
    await unregisterPushNotification();
    expect(unsubscribePush).not.toHaveBeenCalled();
  });

  it('Service Worker が無い環境でも落ちない', async () => {
    setSW(undefined);
    await expect(unregisterPushNotification()).resolves.toBeUndefined();
  });
});

describe('logout — 購読を外してからトークンを消す (#508)', () => {
  beforeEach(() => {
    order.length = 0;
    unsubscribePush.mockReset().mockResolvedValue({});
    sub = { endpoint: 'https://fcm.example/x', unsubscribe: vi.fn(async () => { order.push('sub.unsubscribe'); return true; }) };
    setSW({ getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) });
    useAuthStore.setState({ user: { id: 'u1' } as never, token: 't' });
  });
  afterEach(() => vi.useRealTimers());

  it('★★ サーバーへの取り消しは、トークンを消す前に送る (後だと認証で弾かれる)', async () => {
    await useAuthStore.getState().logout();
    expect(order.indexOf('api.unsubscribePush')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('api.unsubscribePush')).toBeLessThan(order.indexOf('setToken:null'));
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('★ 取り消しが返ってこなくても、ログアウトは終わる', async () => {
    vi.useFakeTimers();
    unsubscribePush.mockReturnValue(new Promise(() => {}));   // 返ってこない
    const done = useAuthStore.getState().logout();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(useAuthStore.getState().user).toBeNull();
    expect(setToken).toHaveBeenCalledWith(null);
  });
});
