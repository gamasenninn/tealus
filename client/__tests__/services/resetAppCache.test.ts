/**
 * #528 「新しいバージョン」の更新とキャッシュクリアで、本体に古い宛先の行が溜まらないようにする。
 * ★ 以前は何もせずに消していたので、読み込み直すたびに新しい行ができ、古い行は送って 410 が返るまで有効のまま (小野さん 半年 480 行)
 * ★★ #546 ブラウザの中の宛先は外さない。今の宛先を覚えておき、読み込み直した画面が登録できたあとで古い方だけ本体から外す
 *   (#528 の初版は外していた。iPhone は利用者のタップなしでは宛先を作り直せず、更新した人に通知が届かなくなった)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
vi.mock('../../src/services/api', () => ({
  api: { unsubscribePush: vi.fn(async (ep: string) => { order.push(`server-unsubscribe:${ep}`); }) },
}));

import { resetAppCache } from '../../src/services/resetAppCache';
import { PREV_ENDPOINT_KEY } from '../../src/services/pushNotification';
import { api } from '../../src/services/api';

function stubBrowser({ withSubscription = true } = {}) {
  const sub = withSubscription
    ? { endpoint: 'https://fcm.example/abc', unsubscribe: vi.fn(async () => { order.push('browser-unsubscribe'); return true; }) }
    : null;
  const reg = {
    pushManager: { getSubscription: vi.fn(async () => sub) },
    unregister: vi.fn(async () => { order.push('sw-unregister'); return true; }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => reg), getRegistrations: vi.fn(async () => [reg]) },
  });
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => ['a', 'b']),
    delete: vi.fn(async (k: string) => { order.push(`cache-delete:${k}`); return true; }),
  });
  return { reg, sub };
}

describe('resetAppCache (#528)', () => {
  beforeEach(() => { order.length = 0; vi.mocked(api.unsubscribePush).mockClear(); localStorage.clear(); });

  it('★★ #546 ブラウザの宛先も本体の行も外さず、今の宛先を覚えておく (読み込み直した画面が片づける)', async () => {
    const { sub } = stubBrowser();
    await resetAppCache();
    expect(sub!.unsubscribe).not.toHaveBeenCalled();
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    expect(localStorage.getItem(PREV_ENDPOINT_KEY)).toBe('https://fcm.example/abc');
  });

  it('キャッシュも消し、サービスワーカーも消す (今までどおり)', async () => {
    stubBrowser();
    await resetAppCache();
    expect(order).toContain('cache-delete:a');
    expect(order).toContain('cache-delete:b');
    expect(order).toContain('sw-unregister');
  });

  it('宛先が無い端末 (通知を許可していない) でも最後まで進み、何も覚えない', async () => {
    stubBrowser({ withSubscription: false });
    await resetAppCache();
    expect(localStorage.getItem(PREV_ENDPOINT_KEY)).toBeNull();
    expect(order).toContain('sw-unregister');
  });

  it('caches も serviceWorker も無い環境でも投げない (#356)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    vi.stubGlobal('caches', undefined);
    await expect(resetAppCache()).resolves.toBeUndefined();
  });
});
