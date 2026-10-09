/**
 * #528 「新しいバージョン」の更新とキャッシュクリアで、サービスワーカーを消す前にプッシュの宛先を本体から外す。
 * ★ 以前は外さずに消していたので、ブラウザの中では宛先が消え、本体には有効な行が残った。
 *   読み込み直すたびに新しい行ができ、古い行は送って 410 が返るまで有効のまま (小野さん 半年 480 行)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const order: string[] = [];
vi.mock('../../src/services/api', () => ({
  api: { unsubscribePush: vi.fn(async (ep: string) => { order.push(`server-unsubscribe:${ep}`); }) },
}));

import { resetAppCache } from '../../src/services/resetAppCache';
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
  beforeEach(() => { order.length = 0; vi.mocked(api.unsubscribePush).mockClear(); });

  it('★ サービスワーカーを消す前に、プッシュの宛先を本体から外す', async () => {
    stubBrowser();
    await resetAppCache();
    expect(api.unsubscribePush).toHaveBeenCalledWith('https://fcm.example/abc');
    expect(order.indexOf('server-unsubscribe:https://fcm.example/abc')).toBeLessThan(order.indexOf('sw-unregister'));
  });

  it('キャッシュも消し、サービスワーカーも消す (今までどおり)', async () => {
    stubBrowser();
    await resetAppCache();
    expect(order).toContain('cache-delete:a');
    expect(order).toContain('cache-delete:b');
    expect(order).toContain('sw-unregister');
  });

  it('宛先が無い端末 (通知を許可していない) でも最後まで進む', async () => {
    stubBrowser({ withSubscription: false });
    await resetAppCache();
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    expect(order).toContain('sw-unregister');
  });

  it('★ 本体へ外すのに失敗しても、キャッシュとサービスワーカーは消す (更新を止めない)', async () => {
    stubBrowser();
    vi.mocked(api.unsubscribePush).mockRejectedValueOnce(new Error('offline'));
    await expect(resetAppCache()).resolves.toBeUndefined();
    expect(order).toContain('sw-unregister');
  });

  it('caches も serviceWorker も無い環境でも投げない (#356)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    vi.stubGlobal('caches', undefined);
    await expect(resetAppCache()).resolves.toBeUndefined();
  });
});
