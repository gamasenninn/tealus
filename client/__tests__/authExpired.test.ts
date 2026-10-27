/**
 * #539 認証が切れた知らせを受けたら、1 回だけログアウトしてログイン画面へ移す
 * ★ ログアウトの中でも本体に問い合わせる (購読の取り消し) ので、そこでまた 401 が返っても繰り返さない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const unregister = vi.fn(() => Promise.resolve());
vi.mock('../src/services/pushNotification', () => ({ registerPushNotification: vi.fn(), startPushResumeRefresh: vi.fn(), unregisterPushNotification: () => unregister() }));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));

const assign = vi.fn();
Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, pathname: '/talk' } });

const { api } = await import('../src/services/api');
const { useAuthStore } = await import('../src/stores/authStore');

describe('認証が切れたとき (#539)', () => {
  beforeEach(() => {
    unregister.mockClear(); assign.mockClear();
    api.setToken('expired');
    useAuthStore.setState({ user: { id: 'u1' } as never, token: 'expired' });
  });

  it('★★ ログアウトしてログイン画面へ移す', async () => {
    api.notifyUnauthorized();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    expect(useAuthStore.getState().token).toBeNull();
    expect(api.token).toBeNull();
  });

  it('★ 続けて何度知らせが来ても、ログアウトは 1 回だけ', async () => {
    api.notifyUnauthorized();
    api.notifyUnauthorized();
    api.notifyUnauthorized();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('★ #600 ログアウトで、覚えていた部屋の中身を捨てる (同じ画面で次の人に前の人の会話を出さない)', async () => {
    const cache = await import('../src/stores/roomViewCache');
    cache.cacheMessages('r1', [{ id: 'm1' }] as never);
    await useAuthStore.getState().logout();
    expect(cache.getCachedMessages('r1')).toBeUndefined();
  });

  // ★ 改善ループ 15 回目: 部屋の一覧と開いていた部屋は残っていた (次の人のログイン直後、前の人の一覧が一瞬出る)
  it('★ ログアウトで、部屋の一覧と開いていた部屋も捨てる', async () => {
    const { useRoomStore } = await import('../src/stores/roomStore');
    useRoomStore.setState({ rooms: [{ id: 'r1' }] as never, currentRoom: { id: 'r1' } as never, members: [{ user_id: 'u1' }] as never });
    await useAuthStore.getState().logout();
    expect(useRoomStore.getState().rooms).toEqual([]);
    expect(useRoomStore.getState().currentRoom).toBeNull();
    expect(useRoomStore.getState().members).toEqual([]);
  });
});

// ★ 改善ループ 18 回目: 期限切れのまま開き直すと、宛先の取り外しが鍵なしで飛んで 401 になっていた (14 日で 10 回)。
//   initialize の catch がトークンを先に消し、ログアウトの取り外しは getRegistration を待った後に本体へ送るため
describe('期限切れのまま開き直したとき', () => {
  it('★★ 宛先の取り外しを本体へ送る時点で、まだ鍵を持っている', async () => {
    let tokenWhenSent: string | null | undefined;
    unregister.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 0));   // 本物は getRegistration・getSubscription を待ってから送る
      tokenWhenSent = api.token;
    });
    localStorage.setItem('token', 'expired');
    vi.spyOn(api, 'getMe').mockImplementationOnce(async () => {
      api.notifyUnauthorized();   // 本物の api は 401 で知らせてから投げる
      throw Object.assign(new Error('401'), { status: 401 });
    });
    useAuthStore.setState({ user: null, token: null, isLoading: true });
    await useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(tokenWhenSent).not.toBeUndefined());
    expect(tokenWhenSent).toBe('expired');
    await vi.waitFor(() => expect(api.token).toBeNull());
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe('ログアウトで前の人の検索を捨てる (改善ループ 18 回目)', () => {
  it('★ 検索の結果 (本文入り) とスクロール位置を消す', async () => {
    sessionStorage.setItem('searchCache', '{"q":"x"}');
    sessionStorage.setItem('searchScroll', '10');
    await useAuthStore.getState().logout();
    expect(sessionStorage.getItem('searchCache')).toBeNull();
    expect(sessionStorage.getItem('searchScroll')).toBeNull();
  });
});

describe('ログイン (#600 監査 B)', () => {
  it('★★ ログアウトせずに別の人がログインしても、前の人が覚えた部屋の中身を捨てる', async () => {
    const cache = await import('../src/stores/roomViewCache');
    cache.cacheMessages('r1', [{ id: 'm1' }] as never);
    vi.spyOn(api, 'login').mockResolvedValue({ token: 't2', user: { id: 'u2' } } as never);
    await useAuthStore.getState().login('b', 'x');
    expect(cache.getCachedMessages('r1')).toBeUndefined();
  });
});
