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

describe('ログイン (#600 監査 B)', () => {
  it('★★ ログアウトせずに別の人がログインしても、前の人が覚えた部屋の中身を捨てる', async () => {
    const cache = await import('../src/stores/roomViewCache');
    cache.cacheMessages('r1', [{ id: 'm1' }] as never);
    vi.spyOn(api, 'login').mockResolvedValue({ token: 't2', user: { id: 'u2' } } as never);
    await useAuthStore.getState().login('b', 'x');
    expect(cache.getCachedMessages('r1')).toBeUndefined();
  });
});
