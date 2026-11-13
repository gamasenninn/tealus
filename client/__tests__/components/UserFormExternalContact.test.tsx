/**
 * 利用者の編集に「社外の窓口」のチェック (2026-11-13 小野さん判断「お客様の部屋のタブ」、docs/02 users.is_external_contact)
 * ★ この口座がいる部屋が、トーク一覧のタブ「お客様」に入る。付けるのは管理者だけ (この画面は管理者の画面)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserForm from '../../src/components/admin/UserForm';
import type { User } from '../../src/types';

const ecFront = { id: 'u-ec', login_id: 'ec-front', display_name: 'EC窓口', role: 'user', is_bot: false, is_external_contact: false } as unknown as User;

describe('UserForm — 社外の窓口', () => {
  it('★ 編集でチェックを入れると is_external_contact: true を送る (変えたものだけ)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<UserForm user={ecFront} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/社外の窓口/));
    fireEvent.click(screen.getByRole('button', { name: /保存|更新/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ is_external_contact: true });
  });

  it('作るときは出さない (付けるのは既にある口座だけ)', () => {
    render(<UserForm user={null} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/社外の窓口/)).toBeNull();
  });
});
