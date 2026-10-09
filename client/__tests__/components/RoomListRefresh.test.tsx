/**
 * #532 部屋の一覧を取り直すきっかけ
 *
 * ★ 以前は新着 (message:new) と部屋の追加・変更でしか取り直さなかった。
 *   - 最後の投稿を編集・削除しても、一覧のプレビューが古いまま (message:updated / message:deleted を聞いていなかった)
 *   - 別の端末で読んでも、一覧の未読数とアプリのバッジが消えない (本体が知らせていなかった → unread:changed を足した)
 */
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (d: unknown) => void>();
const fakeSocket = {
  on: (n: string, fn: (d: unknown) => void) => { handlers.set(n, fn); },
  off: (n: string) => { handlers.delete(n); },
  emit: vi.fn(),
  connected: true,
};
vi.mock('../../src/services/socket', () => ({
  getSocket: () => fakeSocket,
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
}));
vi.mock('../../src/services/api', () => ({ api: { getOnlineUsers: () => Promise.resolve({ online: [] }) } }));

import RoomList from '../../src/components/room-list/RoomList';
import { useRoomStore } from '../../src/stores/roomStore';
import { useAuthStore } from '../../src/stores/authStore';

const fetchRooms = vi.fn();
beforeEach(() => {
  handlers.clear();
  fetchRooms.mockClear();
  useAuthStore.setState({ user: { id: 'me', role: 'user', display_name: '私' } } as never);
  useRoomStore.setState({ rooms: [{ id: 'r1', type: 'group', name: '営業', member_count: 3, unread_count: 2 }], fetchRooms, error: null } as never);
});

const renderList = () => render(<MemoryRouter><RoomList /></MemoryRouter>);

describe('RoomList — 取り直すきっかけ (#532)', () => {
  it.each([
    ['unread:changed', { room_id: 'r1' }, '別の端末で読んだ'],
    ['message:updated', { id: 'm1', room_id: 'r1', content: '直した' }, '最後の投稿を編集した'],
    ['message:deleted', { message_id: 'm1', room_id: 'r1' }, '最後の投稿を消した'],
  ] as Array<[string, unknown, string]>)('★★ %s で一覧を取り直す (%s)', (event, payload, _why) => {
    renderList();
    const before = fetchRooms.mock.calls.length;
    expect(handlers.has(event)).toBe(true);
    act(() => handlers.get(event)!(payload));
    expect(fetchRooms.mock.calls.length).toBe(before + 1);
  });

  it('外したら聞かない (画面を離れたとき)', () => {
    const { unmount } = renderList();
    unmount();
    expect(handlers.has('unread:changed')).toBe(false);
    expect(handlers.has('message:updated')).toBe(false);
    expect(handlers.has('message:deleted')).toBe(false);
  });
});
