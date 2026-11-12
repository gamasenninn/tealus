/**
 * 鍵を使っている間に延ばす (2026-11-12 小野さん判断、docs/05 §5)
 * ★ 本体は残りが半分を切った鍵の応答に X-Refreshed-Token を付ける。画面はそれで鍵を差し替える
 *   (起動時の /auth/me でも、開きっぱなしの PC の普段の通信でも延びる)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../src/services/api';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
});

describe('api — X-Refreshed-Token', () => {
  const onRefreshed = vi.fn();
  beforeEach(() => { localStorage.clear(); onRefreshed.mockReset(); api.setOnTokenRefreshed(onRefreshed); api.retryBackoffMs = [0, 0]; api.requestTimeoutMs = 50; });
  afterEach(() => { vi.unstubAllGlobals(); api.token = null; api.setOnTokenRefreshed(null); });

  it('★ 応答に新しい鍵があれば差し替え (localStorage も)、知らせる', async () => {
    api.setToken('old');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { ok: 1 }, { 'x-refreshed-token': 'fresh' })));
    await api.request('GET', '/auth/me');
    expect(api.token).toBe('fresh');
    expect(localStorage.getItem('token')).toBe('fresh');
    expect(onRefreshed).toHaveBeenCalledWith('fresh');
  });

  it('★ 次の通信は新しい鍵で送る', async () => {
    api.setToken('old');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(200, {}, { 'x-refreshed-token': 'fresh' }))
      .mockResolvedValueOnce(res(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await api.request('GET', '/rooms');
    await api.request('GET', '/rooms');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');
  });

  it('ヘッダーが無ければ何もしない', async () => {
    api.setToken('mine');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {})));
    await api.request('GET', '/rooms');
    expect(api.token).toBe('mine');
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('★ ログアウトしている (鍵が無い) ときは受け取らない', async () => {
    api.token = null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': 'fresh' })));
    await api.request('GET', '/version');
    expect(api.token).toBeNull();
    expect(onRefreshed).not.toHaveBeenCalled();
  });
});
