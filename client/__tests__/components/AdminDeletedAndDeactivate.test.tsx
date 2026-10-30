/**
 * 管理画面: 削除された投稿の一覧と「戻す」(利用者判断 3)・無効化の確かめ (利用者判断 5)。2026-10-30
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getAdminDeletedMessages: vi.fn(),
  restoreAdminDeletedMessage: vi.fn(async () => ({ success: true })),
  getAdminUsers: vi.fn(async () => ({ users: [{ id: 'u2', login_id: 'EMP002', display_name: '鈴木', role: 'user', is_active: true, created_at: '2026-10-01T00:00:00Z' }] })),
  updateAdminUserStatus: vi.fn(async () => ({})),
}));
vi.mock('../../src/services/api', () => ({ api }));
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ user: { id: 'u1', role: 'admin' } }) }));

import DeletedMessages from '../../src/components/admin/DeletedMessages';
import AdminDashboard from '../../src/components/admin/AdminDashboard';

describe('削除された投稿', () => {
  beforeEach(() => {
    api.getAdminDeletedMessages.mockResolvedValue({ messages: [{
      message_id: 'm1', content: '間違えて送った', deleted_at: '2026-10-30T03:00:00Z', type: 'text', room_id: 'r1',
      created_at: '2026-10-30T02:59:00Z', room_name: '業務メモ', sender_display_name: '田中', deleted_by_display_name: '田中',
    }] });
    api.restoreAdminDeletedMessage.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('★★ 本文・部屋・消した人を出し、確かめてから戻す', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DeletedMessages />);
    expect(await screen.findByText('間違えて送った')).toBeTruthy();
    expect(screen.getByText('業務メモ')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '戻す' }));
    await waitFor(() => expect(api.restoreAdminDeletedMessage).toHaveBeenCalledWith('m1'));
  });

  it('確かめで「キャンセル」なら戻さない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DeletedMessages />);
    fireEvent.click(await screen.findByRole('button', { name: '戻す' }));
    expect(api.restoreAdminDeletedMessage).not.toHaveBeenCalled();
  });
});

describe('無効化の確かめ', () => {
  beforeEach(() => api.updateAdminUserStatus.mockClear());
  afterEach(() => vi.restoreAllMocks());

  const openMenuAndDeactivate = async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    fireEvent.click(await screen.findByText('⋮'));
    fireEvent.click(await screen.findByText('無効化'));
  };

  it('★★ 確かめで「キャンセル」なら止めない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openMenuAndDeactivate();
    expect(window.confirm).toHaveBeenCalled();
    expect(api.updateAdminUserStatus).not.toHaveBeenCalled();
  });

  it('OK なら止める', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openMenuAndDeactivate();
    await waitFor(() => expect(api.updateAdminUserStatus).toHaveBeenCalledWith('u2', false));
  });
});
