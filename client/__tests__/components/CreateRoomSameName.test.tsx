/**
 * 同じ名前のグループは作れるが、既にあることを知らせる (2026-11-05 小野さん判断 2)
 *
 * ★ 11-02 に人とボットが同じ名前の部屋を 1 つずつ作った。作った直後に画面を閉じて部屋へ移るので、
 *   重なりに気づく場面が無かった。本体が返す「同じ名前の部屋の数」が 1 以上なら、閉じずに知らせる
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const createGroup = vi.fn();
vi.mock('../../src/stores/roomStore', () => ({
  useRoomStore: () => ({ createGroup: (...a: unknown[]) => createGroup(...a), createDirect: vi.fn() }),
}));
vi.mock('../../src/services/api', () => ({ api: { getUsers: vi.fn().mockResolvedValue({ users: [] }) } }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import CreateRoom from '../../src/components/room-list/CreateRoom';

describe('CreateRoom — 同じ名前のグループ', () => {
  beforeEach(() => { createGroup.mockReset(); navigate.mockReset(); });

  async function create(onClose = vi.fn()) {
    render(<CreateRoom onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'グループ作成' }));
    fireEvent.change(screen.getByPlaceholderText('グループ名'), { target: { value: '飛行船ECサイト構築' } });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    return onClose;
  }

  it('★ 同じ名前の部屋がほかにあれば、閉じずに知らせ、押すと作った部屋を開く', async () => {
    createGroup.mockResolvedValue({ room: { id: 'r-new' }, same_name_rooms: 1 });
    const onClose = await create();
    expect(await screen.findByText(/同じ名前のグループがほかに 1 つ/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '作った部屋を開く' }));
    expect(navigate).toHaveBeenCalledWith('/rooms/r-new');
    expect(onClose).toHaveBeenCalled();
  });

  it('同じ名前の部屋が無ければ、今までどおりすぐ開く', async () => {
    createGroup.mockResolvedValue({ room: { id: 'r-new' }, same_name_rooms: 0 });
    const onClose = await create();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/rooms/r-new'));
    expect(onClose).toHaveBeenCalled();
  });
});
