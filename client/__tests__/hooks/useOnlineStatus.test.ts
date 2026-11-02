// 在席の緑の点 (改善ループ 36)
// ★ 以前は開いたときに 1 回だけ一覧を取り、あとは user:online / offline の差分だけで直していた。
//   端末が眠って socket が切れている間の offline を取りこぼすと、つなぎ直しても取り直さないので、
//   帰った人が部屋を開き直すまで緑のまま残った
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useOnlineStatus } from '../../src/hooks/useOnlineStatus';

const handlers = new Map<string, (d?: unknown) => void>();
vi.mock('../../src/services/socket', () => ({
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
  beforeEach(() => { handlers.clear(); getOnlineUsers.mockReset(); role = 'user'; });

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
    act(() => handlers.get('connect')!());
    await waitFor(() => expect([...result.current.onlineUsers]).toEqual(['b']));
  });

  it('★ ゲストは取りに行かない (つなぎ直しでも。本体が 403)', async () => {
    role = 'guest';
    renderHook(() => useOnlineStatus());
    act(() => handlers.get('connect')?.());
    expect(getOnlineUsers).not.toHaveBeenCalled();
  });
});
