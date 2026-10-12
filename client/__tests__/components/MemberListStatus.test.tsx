import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

/**
 * #591 プロフィールの「ひとこと」(status_message) をメンバー一覧に出す。
 * ★ 以前は書けるのに、自分の編集欄以外のどこにも出ていなかった (本番で 3 人が書いていた)
 */
const members = [
  { user_id: 'u1', display_name: '甲野', role: 'admin', status_message: null },
  { user_id: 'u2', display_name: '乙山', role: 'member', status_message: '外回り中' },
  { user_id: 'u3', display_name: '丙川', role: 'member', status_message: '  ' },
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

describe('#591 メンバー一覧の「ひとこと」', () => {
  it('★ 書いている人は名前の下に出る', () => {
    render(<MemoryRouter><MemberList roomId="r1" onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByText('外回り中')).toBeTruthy();
  });

  it('空・空白だけ・null なら何も出さない (行を増やさない)', () => {
    const { container } = render(<MemoryRouter><MemberList roomId="r1" onClose={() => {}} /></MemoryRouter>);
    expect(container.querySelectorAll('.member-status')).toHaveLength(1);
  });
});
