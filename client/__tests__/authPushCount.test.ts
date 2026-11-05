/**
 * 起動の確かめで、本体が数えた「有効な通知の宛先の本数」を覚える (改善ループ 40)
 *
 * ★ 0 本なら PushOnboardingBanner が許可の状態に関係なく案内する。黙って登録し直せた端末 (Android・PC) では案内を消す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const register = vi.fn(async () => 'ok');
const permission = vi.fn(() => 'granted');
vi.mock('../src/services/pushNotification', () => ({
  registerPushNotification: () => register(), pushPermission: () => permission(),
  startPushResumeRefresh: vi.fn(), unregisterPushNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../src/services/clientConfig', () => ({ loadConfig: vi.fn(async () => ({})), getConfig: () => ({ vapid_public_key: 'K' }) }));

const { api } = await import('../src/services/api');
const { useAuthStore } = await import('../src/stores/authStore');

describe('有効な通知の宛先の本数', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't');
    useAuthStore.setState({ user: null, token: 't', pushActiveSubscriptions: null });
  });

  it('★ 本体が 0 本と言い、黙って登録し直せなかったら 0 のまま (案内が出る)', async () => {
    permission.mockReturnValue('denied');
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { id: 'u1' }, push_active_subscriptions: 0 } as never);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().pushActiveSubscriptions).toBe(0);
  });

  it('★ 許可済みで黙って登録し直せたら、0 本の案内は消す', async () => {
    permission.mockReturnValue('granted');
    register.mockResolvedValue('ok');
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { id: 'u1' }, push_active_subscriptions: 0 } as never);
    await useAuthStore.getState().initialize();
    await vi.waitFor(() => expect(useAuthStore.getState().pushActiveSubscriptions).toBe(1));
  });

  it('古い本体 (本数を返さない) なら null = 今までどおり', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { id: 'u1' } } as never);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().pushActiveSubscriptions).toBeNull();
  });

  it('★ 一度も登録していない人 (外れたものも 0 本) は「以前は届いていた」にしない (改善ループ 41)', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { id: 'u1' }, push_active_subscriptions: 0, push_total_subscriptions: 0 } as never);
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().pushHadSubscriptions).toBe(false);
  });

  it('★ ログインの道では前の人の本数を残さない (改善ループ 41)', async () => {
    useAuthStore.setState({ pushActiveSubscriptions: 0 });
    vi.spyOn(api, 'login').mockResolvedValue({ token: 't2', user: { id: 'u2' } } as never);
    await useAuthStore.getState().login('EMP002', 'password1');
    expect(useAuthStore.getState().pushActiveSubscriptions).toBeNull();
  });
});
