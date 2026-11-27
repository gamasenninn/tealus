/**
 * #502 PC のマルチトーク: 左の一覧 (RoomList) で部屋を押したとき
 * ★ 以前は `/multi` でも部屋へ移り、マルチトークを抜けていた (内側の一覧はパネルを開いた)。
 *   同じ見た目で押した結果が違ったので、`/multi` では RoomList でパネルを開く
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}
function renderWithLoc(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<><RoomList /><Loc /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RoomList — マルチトークのタスクの帯 (docs/16 §5.1)', () => {
  beforeEach(() => { useMultiTalkStore.setState({ tasksOpen: false }); });

  it('★★ /multi で「タスク」を押すと、移らずに右の帯を出す / もう一度で隠す', () => {
    renderWithLoc('/multi');
    fireEvent.click(screen.getByTitle('タスク'));
    expect(useMultiTalkStore.getState().tasksOpen).toBe(true);
    expect(screen.getByTestId('loc').textContent).toBe('/multi');
    fireEvent.click(screen.getByTitle('タスク'));
    expect(useMultiTalkStore.getState().tasksOpen).toBe(false);
  });

  it('ほかの画面では帯を出さない (タスクの画面へ移る)', () => {
    renderWithLoc('/talk');
    fireEvent.click(screen.getByTitle('タスク'));
    expect(useMultiTalkStore.getState().tasksOpen).toBe(false);
    expect(screen.getByTestId('loc').textContent).toBe('/tasks');
  });
});
