import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

/**
 * 利用停止にした人の、部屋での見え方 (改善ループ 2026-10-13 の 4.)
 * ★ 一覧には残して「利用停止」と添える (誰がいたかは分かる)。メンションの候補には出さない (選んでも届かない)
 */
const members = [
  { user_id: 'u1', display_name: '在籍', role: 'admin', is_active: true },
  { user_id: 'u2', display_name: '退職', role: 'member', is_active: false },
  { user_id: 'u3', display_name: '古い応答', role: 'member' },   // is_active を持たない (古い本体) は在籍扱い
];
vi.mock('../../src/stores/authStore', () => {
  const state = () => ({ user: { id: 'u1', role: 'user' } });
  const useAuthStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useAuthStore };
});
vi.mock('../../src/stores/roomStore', () => {
  const state = () => ({ currentRoom: { id: 'r1', type: 'group', name: '部屋' }, members, selectRoom: vi.fn() });
  const useRoomStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state());
  return { useRoomStore };
});
vi.mock('../../src/stores/confirmStore', () => ({ useConfirm: () => vi.fn() }));
vi.mock('../../src/services/api', () => ({ api: {} }));
vi.mock('../../src/components/chat/RoomSettings', () => ({ default: () => null }));

import MemberList from '../../src/components/chat/MemberList';
import MentionPicker from '../../src/components/chat/MentionPicker';

describe('利用停止にした人', () => {
  it('★ メンバー一覧には残り、その人にだけ「利用停止」と出る', () => {
    const { container } = render(<MemoryRouter><MemberList roomId="r1" onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByText('退職')).toBeTruthy();
    expect(container.querySelectorAll('.member-inactive')).toHaveLength(1);
    expect(container.querySelector('.member-inactive')!.textContent).toContain('利用停止');
  });

  it('★ メンションの候補には出さない。is_active を持たない人は今までどおり出す', () => {
    render(<MentionPicker members={members} query="" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('退職')).toBeNull();
    expect(screen.getByText('在籍')).toBeTruthy();
    expect(screen.getByText('古い応答')).toBeTruthy();
  });
});
