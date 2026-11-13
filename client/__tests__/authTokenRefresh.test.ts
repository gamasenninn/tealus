/**
 * 鍵を延ばしたら、画面の状態 (authStore) の鍵も差し替える (改善ループ 49、2026-11-13)
 * ★ 受け手は socket しか差し替えていなかった。エラー報告 (errorReport.ts) は store の鍵を使うので、
 *   開きっぱなしで古い鍵が切れたあとはエラー報告が利用者不明になっていた
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const updateSocketToken = vi.fn();
vi.mock('../src/services/pushNotification', () => ({
  registerPushNotification: vi.fn(), pushPermission: () => 'granted',
  startPushResumeRefresh: vi.fn(), unregisterPushNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), updateSocketToken: (t: string) => updateSocketToken(t) }));

const { api } = await import('../src/services/api');
const { useAuthStore } = await import('../src/stores/authStore');

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwtOf = (p: { id: string; exp: number }) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}.sig`;
const res = (headers: Record<string, string>) => ({
  ok: true, status: 200, json: async () => ({}),
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
});

describe('鍵を延ばしたとき (改善ループ 49)', () => {
  afterEach(() => { vi.unstubAllGlobals(); api.token = null; localStorage.clear(); });

  it('★ store の鍵と socket の鍵を新しい鍵に替える', async () => {
    const old = jwtOf({ id: 'u-1', exp: 1_800_000_000 });
    const fresh = jwtOf({ id: 'u-1', exp: 1_800_600_000 });
    api.setToken(old);
    useAuthStore.setState({ token: old });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ 'x-refreshed-token': fresh })));
    await api.request('GET', '/rooms');
    expect(useAuthStore.getState().token).toBe(fresh);
    expect(updateSocketToken).toHaveBeenCalledWith(fresh);
  });
});
