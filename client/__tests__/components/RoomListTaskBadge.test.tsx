/**
 * ★ タスク 33: 上のメニューの「タスク」に、期限切れがあれば赤い数字 (docs/16 §5)
 * ★ 引けなかったら何も出さない (一覧の画面を邪魔しない)
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({
  getOnlineUsers: () => Promise.resolve({ online: [] }),
  listTasks: vi.fn(),
}));
vi.mock('../../src/services/socket', () => ({ getSocket: () => null }));
vi.mock('../../src/services/api', () => ({ api }));

import RoomList from '../../src/components/room-list/RoomList';
import { useRoomStore } from '../../src/stores/roomStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';

const renderList = () => {
  useRoomStore.setState({ rooms: [], fetchRooms: vi.fn(), error: null } as never);
  return render(<MemoryRouter initialEntries={['/talk']}><RoomList /></MemoryRouter>);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 30, 10, 0));
  useAuthStore.setState({ user: { id: 'me', role: 'user', display_name: '私' } } as never);
  useMultiTalkStore.setState({ pendingOpen: null, openRoomIds: [], sidebarHidden: false });
  api.listTasks.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('RoomList — タスクの期限切れの数', () => {
  it('期限切れがあれば、タスクのボタンに赤い数字', async () => {
    api.listTasks.mockResolvedValue({ tasks: [
      { id: 'a', status: 'open', due_date: '2026-11-29' },
      { id: 'b', status: 'held', due_date: '2026-11-01' },
      { id: 'c', status: 'open', due_date: '2026-11-30' },
      { id: 'd', status: 'open', due_date: null },
    ] });
    renderList();
    const badge = await screen.findByLabelText('期限切れ 2 件');
    expect(badge.textContent).toBe('2');
    expect(badge.closest('button')?.getAttribute('title')).toBe('タスク');
    expect(api.listTasks).toHaveBeenCalledWith();
  });

  it('期限切れが無ければ出さない', async () => {
    api.listTasks.mockResolvedValue({ tasks: [{ id: 'c', status: 'open', due_date: '2026-11-30' }] });
    renderList();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(screen.queryByLabelText(/期限切れ/)).toBeNull();
  });

  it('引けなかったら出さない (エラーも出さない)', async () => {
    api.listTasks.mockRejectedValue(new Error('500'));
    renderList();
    await waitFor(() => expect(api.listTasks).toHaveBeenCalled());
    expect(screen.queryByLabelText(/期限切れ/)).toBeNull();
  });

  it('ゲストはタスクのボタンが無いので引かない', async () => {
    useAuthStore.setState({ user: { id: 'g', role: 'guest', display_name: 'お客' } } as never);
    renderList();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.listTasks).not.toHaveBeenCalled();
  });
});
