/**
 * トーク一覧: アイコンが無い部屋は名前の最初の 1 文字を出す (2026-11-23 小野さん)
 * ★ 以前は 1 対 1 が 👤、グループが 👥 で、アイコンの無い部屋が全部同じに見えていた
 * ★ 1 文字は「見た目の 1 文字」で取る (絵文字のような 2 単位の文字を半分に割らない)
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/socket', () => ({ getSocket: () => null }));
vi.mock('../../src/services/api', () => ({ api: { getOnlineUsers: () => Promise.resolve({ online: [] }) } }));

import RoomList from '../../src/components/room-list/RoomList';
import { useRoomStore } from '../../src/stores/roomStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';

function avatars(rooms: unknown[]) {
  useRoomStore.setState({ rooms, fetchRooms: vi.fn(), error: null } as never);
  const { container } = render(<MemoryRouter initialEntries={['/talk']}><RoomList /></MemoryRouter>);
  return [...container.querySelectorAll('.room-item .room-avatar')];
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'me', role: 'user', display_name: '私' } } as never);
  useMultiTalkStore.setState({ pendingOpen: null, openRoomIds: [], sidebarHidden: false });
});

describe('RoomList — アイコンが無い部屋の頭文字', () => {
  it('★★ 1 対 1 で相手に画像が無ければ、相手の名前の 1 文字目', () => {
    const [a] = avatars([{ id: 'r1', type: 'direct', name: null, partner_display_name: '田中一郎', unread_count: 0 }]);
    expect(a.querySelector('img')).toBeNull();
    expect(a.textContent).toBe('田');
  });

  it('★ グループでアイコンが無ければ、部屋の名前の 1 文字目 (人数の括弧は入れない)', () => {
    const [a] = avatars([{ id: 'r1', type: 'group', name: 'e2e-sandbox', member_count: 3, unread_count: 0 }]);
    expect(a.textContent).toBe('E');
  });

  it('★ 絵文字で始まる名前も 1 文字まるごと出す (半分に割らない)', () => {
    const [a] = avatars([{ id: 'r1', type: 'group', name: '🚜整備', member_count: 2, unread_count: 0 }]);
    expect(a.textContent).toBe('🚜');
  });

  it('名前が空なら今までの絵 (👤 / 👥)', () => {
    const [d, g] = avatars([
      { id: 'r1', type: 'direct', name: null, partner_display_name: null, unread_count: 0 },
      { id: 'r2', type: 'group', name: '  ', member_count: 2, unread_count: 0 },
    ]);
    expect(d.textContent).toBe('👤');
    expect(g.textContent).toBe('👥');
  });

  it('画像があれば今までどおり画像', () => {
    const [d, g] = avatars([
      { id: 'r1', type: 'direct', name: null, partner_display_name: '田中', partner_avatar_url: 'avatars/a.png', unread_count: 0 },
      { id: 'r2', type: 'group', name: '営業', member_count: 2, icon_url: 'icons/b.png', unread_count: 0 },
    ]);
    expect(d.querySelector('img')?.getAttribute('src')).toBe('/media/avatars/a.png');
    expect(g.querySelector('img')?.getAttribute('src')).toBe('/media/icons/b.png');
  });
});
