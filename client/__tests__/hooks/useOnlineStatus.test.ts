// 在席の緑の点 (改善ループ 36)
// ★ 以前は開いたときに 1 回だけ一覧を取り、あとは user:online / offline の差分だけで直していた。
//   端末が眠って socket が切れている間の offline を取りこぼすと、つなぎ直しても取り直さないので、
//   帰った人が部屋を開き直すまで緑のまま残った
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnlineStatus } from '../../src/hooks/useOnlineStatus';

const handlers = new Map<string, (d?: unknown) => void>();
let disconnectedAfterConnect = false;
vi.mock('../../src/services/socket', () => ({
  isSocketDisconnectedAfterConnect: () => disconnectedAfterConnect,
  getSocket: () => ({
    on: (name: string, fn: (d?: unknown) => void) => handlers.set(name, fn),
    off: (name: string) => handlers.delete(name),
  }),
}));
const getOnlineUsers = vi.fn();
vi.mock('../../src/services/api', () => ({ api: { getOnlineUsers: () => getOnlineUsers() } }));
let role = 'user';
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: 'me', role } }) } }));

describe('useOnlineStatus', () => {
  beforeEach(() => { handlers.clear(); getOnlineUsers.mockReset(); role = 'user'; disconnectedAfterConnect = false; });

  it('開いたときに一覧を取り、online / offline の差分で直す', async () => {
    getOnlineUsers.mockResolvedValue({ online: ['a'] });
    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current.onlineUsers.has('a')).toBe(true));
    act(() => handlers.get('user:online')!({ user_id: 'b' }));
    act(() => handlers.get('user:offline')!({ user_id: 'a' }));
    expect([...result.current.onlineUsers]).toEqual(['b']);
  });

  it('★ つなぎ直したら一覧を取り直す (切れている間の offline を取りこぼしても残らない)', async () => {
    getOnlineUsers.mockResolvedValueOnce({ online: ['a', 'b'] });
    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current.onlineUsers.size).toBe(2));
    getOnlineUsers.mockResolvedValueOnce({ online: ['b'] });
    act(() => handlers.get('disconnect')!());
    act(() => handlers.get('connect')!());
    await waitFor(() => expect([...result.current.onlineUsers]).toEqual(['b']));
  });

  it('★ 起動直後の最初の connect では取り直さない (開いたときの読み込みと 2 重になる、改善ループ 37)', async () => {
    getOnlineUsers.mockResolvedValue({ online: ['a'] });
    renderHook(() => useOnlineStatus());
    act(() => handlers.get('connect')!());
    expect(getOnlineUsers).toHaveBeenCalledTimes(1);
  });

  it('★ 切れている最中に開いたら、最初の connect で取り直す', async () => {
    disconnectedAfterConnect = true;
    getOnlineUsers.mockResolvedValue({ online: ['a'] });
    renderHook(() => useOnlineStatus());
    act(() => handlers.get('connect')!());
    expect(getOnlineUsers).toHaveBeenCalledTimes(2);
  });

  it('★ ゲストは取りに行かない (つなぎ直しでも。本体が 403)', async () => {
    role = 'guest';
    renderHook(() => useOnlineStatus());
    act(() => handlers.get('connect')?.());
    expect(getOnlineUsers).not.toHaveBeenCalled();
  });
});
