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

  // ★ 改善ループ 48 から、受け取るのは「同じ人で期限が後」の読める鍵だけなので、本物の形の鍵で試す
  const oldTok = () => jwtOf({ id: 'u-1', exp: 1_800_000_000 });
  const freshTok = () => jwtOf({ id: 'u-1', exp: 1_800_600_000 });

  it('★ 応答に新しい鍵があれば差し替え (localStorage も)、知らせる', async () => {
    api.setToken(oldTok());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { ok: 1 }, { 'x-refreshed-token': freshTok() })));
    await api.request('GET', '/auth/me');
    expect(api.token).toBe(freshTok());
    expect(localStorage.getItem('token')).toBe(freshTok());
    expect(onRefreshed).toHaveBeenCalledWith(freshTok());
  });

  it('★ 次の通信は新しい鍵で送る', async () => {
    api.setToken(oldTok());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(200, {}, { 'x-refreshed-token': freshTok() }))
      .mockResolvedValueOnce(res(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await api.request('GET', '/rooms');
    await api.request('GET', '/rooms');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${freshTok()}`);
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

/**
 * 改善ループ 48 (2026-11-13) ブラウザのキャッシュに残った古いヘッダーを取り込まない
 * ★ /api の GET はブラウザが保存して 304 で確かめ直す。304 では届いたヘッダーだけが差し替わるので、
 *   以前の応答に付いた X-Refreshed-Token (古い鍵・共用 PC では前の人の鍵) がそのまま見える。
 *   受け取るのは「今の鍵と同じ人で、期限が今より後」の鍵だけ
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwtOf = (p: { id: string; exp: number }) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}.sig`;

describe('api — 古い鍵・他人の鍵を取り込まない (改善ループ 48)', () => {
  const onRefreshed = vi.fn();
  beforeEach(() => { localStorage.clear(); onRefreshed.mockReset(); api.setOnTokenRefreshed(onRefreshed); api.retryBackoffMs = [0, 0]; api.requestTimeoutMs = 50; });
  afterEach(() => { vi.unstubAllGlobals(); api.token = null; api.setOnTokenRefreshed(null); });

  const now = 1_800_000_000;
  const mine = jwtOf({ id: 'u-x', exp: now + 2 * 86400 });

  it('★ 同じ人で期限が後なら受け取る', async () => {
    api.setToken(mine);
    const fresh = jwtOf({ id: 'u-x', exp: now + 7 * 86400 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': fresh })));
    await api.request('GET', '/rooms');
    expect(api.token).toBe(fresh);
    expect(onRefreshed).toHaveBeenCalledWith(fresh);
  });

  it('★★ 期限が今より前の鍵 (キャッシュに残った古い鍵) は受け取らない', async () => {
    api.setToken(mine);
    const stale = jwtOf({ id: 'u-x', exp: now - 86400 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(304, {}, { 'x-refreshed-token': stale })));
    await api.request('GET', '/rooms').catch(() => {});
    expect(api.token).toBe(mine);
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('★★ 別の人の鍵 (共用 PC でキャッシュに残った前の人の鍵) は受け取らない', async () => {
    api.setToken(mine);
    const other = jwtOf({ id: 'u-admin', exp: now + 7 * 86400 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': other })));
    await api.request('GET', '/rooms/portal-links');
    expect(api.token).toBe(mine);
    expect(localStorage.getItem('token')).toBe(mine);
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it('★ 保存場所に別のタブで入り直した別の人の鍵があれば、保存場所は書き換えない (このタブの鍵は延ばす)', async () => {
    api.setToken(mine);
    const otherTab = jwtOf({ id: 'u-y', exp: now + 7 * 86400 });
    localStorage.setItem('token', otherTab);
    const fresh = jwtOf({ id: 'u-x', exp: now + 7 * 86400 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': fresh })));
    await api.request('GET', '/rooms');
    expect(api.token).toBe(fresh);
    expect(localStorage.getItem('token')).toBe(otherTab);
  });

  it('★ 別のタブでログアウト済み (保存場所が空) なら、保存場所に書き戻さない', async () => {
    api.setToken(mine);
    localStorage.removeItem('token');
    const fresh = jwtOf({ id: 'u-x', exp: now + 7 * 86400 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': fresh })));
    await api.request('GET', '/rooms');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('読めない鍵は受け取らない', async () => {
    api.setToken(mine);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {}, { 'x-refreshed-token': 'not-a-jwt' })));
    await api.request('GET', '/rooms');
    expect(api.token).toBe(mine);
  });
});
