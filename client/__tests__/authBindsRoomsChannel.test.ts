/**
 * ログインした人が決まったら、部屋の一覧の分け合い (BroadcastChannel) を張る (改善ループ 43)
 *
 * ★ 改善ループ 42 で部屋の知らせの取り直しを fetchRoomsFromEvent に移したが、分け合いの通り道は
 *   一覧の画面 (RoomList) だけが張っていた。マルチトークのパネルは一覧を出さない (#502) ので通り道が無く、
 *   パネル 8 つが今までどおりそれぞれ取りに行っていた (直しが本命に効いていなかった)。
 *   → 一覧の画面に頼らず、起動の確かめとログインで張る
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/pushNotification', () => ({
  registerPushNotification: vi.fn(async () => 'ok'), pushPermission: () => 'default',
  startPushResumeRefresh: vi.fn(), unregisterPushNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn() }));
vi.mock('../src/services/clientConfig', () => ({ loadConfig: vi.fn(async () => ({})), getConfig: () => ({}) }));
const bind = vi.fn();
vi.mock('../src/stores/roomStore', async (orig) => ({
  ...(await orig<typeof import('../src/stores/roomStore')>()),
  bindRoomsChannel: (id: string) => bind(id),
}));

const { api } = await import('../src/services/api');
const { useAuthStore } = await import('../src/stores/authStore');

describe('部屋の一覧の分け合いを張る', () => {
  beforeEach(() => {
    bind.mockClear();
    localStorage.setItem('token', 't');
    useAuthStore.setState({ user: null, token: 't' });
  });

  it('★ 起動の確かめ (パネルの中もここを通る) で張る', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { id: 'u1' } } as never);
    await useAuthStore.getState().initialize();
    expect(bind).toHaveBeenCalledWith('u1');
  });

  it('★ ログインでも張る', async () => {
    vi.spyOn(api, 'login').mockResolvedValue({ token: 't2', user: { id: 'u2' } } as never);
    await useAuthStore.getState().login('EMP002', 'password1');
    expect(bind).toHaveBeenCalledWith('u2');
  });
});
