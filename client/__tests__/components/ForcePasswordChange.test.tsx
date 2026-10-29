/**
 * 管理者が作った人は、初めてログインしたらパスワードを変えるまで変更の画面だけを出す
 * (2026-10-29 小野さん判断 7、docs/02 users.must_change_password)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const changePassword = vi.fn(async () => ({ message: 'ok' }));
vi.mock('../../src/services/api', () => ({ api: { changePassword: (...a: unknown[]) => changePassword(...(a as [])) } }));
const setUser = vi.fn();
const logout = vi.fn(async () => {});
vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1', display_name: '新人', must_change_password: true }, setUser, logout }),
}));

import ForcePasswordChange from '../../src/components/auth/ForcePasswordChange';

const fill = (cur: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText('いまのパスワード'), { target: { value: cur } });
  fireEvent.change(screen.getByLabelText('新しいパスワード (8 文字以上)'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('新しいパスワード (確認)'), { target: { value: again } });
  fireEvent.click(screen.getByRole('button', { name: '変更する' }));
};

describe('ForcePasswordChange', () => {
  beforeEach(() => { changePassword.mockClear(); setUser.mockClear(); });

  it('★ 8 文字未満・確認と違う、は本体に送らずに知らせる', () => {
    render(<ForcePasswordChange />);
    fill('temp-pass1', 'short', 'short');
    expect(screen.getByText(/8 文字以上/, { selector: '.force-pw-error' })).toBeTruthy();
    fill('temp-pass1', 'long-enough', 'different1');
    expect(screen.getByText(/一致しません/)).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('★★ 変えたら「変更が要る」を落として、そのまま使い始める', async () => {
    render(<ForcePasswordChange />);
    fill('temp-pass1', 'my-own-pass', 'my-own-pass');
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('temp-pass1', 'my-own-pass'));
    await waitFor(() => expect(setUser).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', must_change_password: false })));
  });
});
