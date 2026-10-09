/**
 * #539 認証が切れた知らせを受けたら、1 回だけログアウトしてログイン画面へ移す
 * ★ ログアウトの中でも本体に問い合わせる (購読の取り消し) ので、そこでまた 401 が返っても繰り返さない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const unregister = vi.fn(() => Promise.resolve());
vi.mock('../src/services/pushNotification', () => ({ registerPushNotification: vi.fn(), unregisterPushNotification: () => unregister() }));
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
});
