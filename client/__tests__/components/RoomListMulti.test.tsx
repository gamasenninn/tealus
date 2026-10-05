/**
 * #502 PC のマルチトーク: 左の一覧 (RoomList) で部屋を押したとき
 * ★ 以前は `/multi` でも部屋へ移り、マルチトークを抜けていた (内側の一覧はパネルを開いた)。
 *   同じ見た目で押した結果が違ったので、`/multi` では RoomList でパネルを開く
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/socket', () => ({ getSocket: () => null }));
vi.mock('../../src/services/api', () => ({ api: { getOnlineUsers: () => Promise.resolve({ online: [] }) } }));

import RoomList from '../../src/components/room-list/RoomList';
import { useRoomStore } from '../../src/stores/roomStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';

const rooms = [
  { id: 'r1', type: 'group', name: '営業', member_count: 3, unread_count: 2 },
  { id: 'r2', type: 'direct', name: null, partner_display_name: '田中', unread_count: 0 },
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<><RoomList /><Where /></>} />
      </Routes>
    </MemoryRouter>
  );
}
function Where() {
  return <div data-testid="where">{window.location.pathname}</div>;
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'me', role: 'user', display_name: '私' } } as never);
  useRoomStore.setState({ rooms, fetchRooms: vi.fn(), error: null } as never);
  useMultiTalkStore.setState({ pendingOpen: null, openRoomIds: [], sidebarHidden: false });
});

describe('RoomList — マルチトーク (#502)', () => {
  it('★★ /multi で押すと、移らずにパネルを開くよう頼む', () => {
    renderAt('/multi');
    fireEvent.click(screen.getByText('営業（3）'));
    expect(useMultiTalkStore.getState().pendingOpen).toEqual({ id: 'r1', name: '営業' });
  });

  it('★ 1 対 1 は相手の名前でパネルを開く', () => {
    renderAt('/multi');
    fireEvent.click(screen.getByText('田中'));
    expect(useMultiTalkStore.getState().pendingOpen).toEqual({ id: 'r2', name: '田中' });
  });

  it('★ /multi で押しても、未読はその場で 0 にする (今までどおり)', () => {
    renderAt('/multi');
    fireEvent.click(screen.getByText('営業（3）'));
    expect(useRoomStore.getState().rooms.find((r) => r.id === 'r1')?.unread_count).toBe(0);
  });

  it('★ ほかの画面ではパネルを頼まない (部屋へ移る)', () => {
    renderAt('/talk');
    fireEvent.click(screen.getByText('営業（3）'));
    expect(useMultiTalkStore.getState().pendingOpen).toBeNull();
  });

  it('★ /multi では、パネルで開いている部屋に印が付く', () => {
    useMultiTalkStore.setState({ openRoomIds: ['r2'] });
    const { container } = renderAt('/multi');
    const items = [...container.querySelectorAll('.room-item')];
    expect(items.map((e) => e.classList.contains('open-in-panel'))).toEqual([false, true]);
  });

  it('ほかの画面では印を付けない', () => {
    useMultiTalkStore.setState({ openRoomIds: ['r2'] });
    const { container } = renderAt('/talk');
    expect(container.querySelectorAll('.room-item.open-in-panel')).toHaveLength(0);
  });
});
