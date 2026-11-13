/**
 * 鍵を延ばしたとき、画面のどこが新しい鍵を使うか (改善ループ 49・50、2026-11-13)
 * ★ ループ 49 で store の鍵も差し替えたら、通話の別ウィンドウが閉じて開き直される筋ができた
 *   (useCallNotification の getCallUrl が store の鍵を URL に埋め、CallWindow は URL が変わると開き直す)。
 *   store の鍵は替えず、エラー報告 (errorReport.ts) は api が持つ今の鍵で送る
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
const { reportClientError } = await import('../src/services/errorReport');

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwtOf = (p: { id: string; exp: number }) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}.sig`;
const res = (headers: Record<string, string>) => ({
  ok: true, status: 200, json: async () => ({}),
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
});

describe('鍵を延ばしたとき (改善ループ 49・50)', () => {
  afterEach(() => { vi.unstubAllGlobals(); api.token = null; localStorage.clear(); });

  it('★ socket の鍵は替え、store の鍵は替えない (通話のウィンドウを開き直させない)', async () => {
    const old = jwtOf({ id: 'u-1', exp: 1_800_000_000 });
    const fresh = jwtOf({ id: 'u-1', exp: 1_800_600_000 });
    api.setToken(old);
    useAuthStore.setState({ token: old });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ 'x-refreshed-token': fresh })));
    await api.request('GET', '/rooms');
    expect(updateSocketToken).toHaveBeenCalledWith(fresh);
    expect(useAuthStore.getState().token).toBe(old);
  });

  it('★ エラー報告は api が持つ今の (延ばした) 鍵で送る', async () => {
    const old = jwtOf({ id: 'u-1', exp: 1_800_000_000 });
    const fresh = jwtOf({ id: 'u-1', exp: 1_800_600_000 });
    useAuthStore.setState({ token: old });
    api.token = fresh;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    reportClientError('error', new Error('ループ 50 の確かめ'));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fresh}`);
  });
});
