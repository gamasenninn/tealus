/**
 * ログインのあと、`?next=` のアプリの中のパスへ戻す (docs/11 §5.5、2026-11-17)。
 * ★ 以前はいつもトップ (/) へ戻っていた。よそへ出る形は / に倒す
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const login = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => ({ login }) }));

import Login from '../../src/components/auth/Login';

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

async function loginAt(path: string): Promise<string> {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('ユーザーID'), { target: { value: 'user001' } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'pw' } });
  fireEvent.submit(screen.getByLabelText('ユーザーID').closest('form')!);
  await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
  return screen.getByTestId('where').textContent!;
}

describe('Login の ?next=', () => {
  it('★ アプリの中のパスなら、ログインのあとそこへ戻る', async () => {
    const next = '/sso/app-login?aud=https%3A%2F%2Fportal.example.com&state=0123456789abcdef0123456789abcdef';
    expect(await loginAt(`/login?next=${encodeURIComponent(next)}`)).toBe(next);
  });

  it('★ よそへ出る形ならトップへ', async () => {
    expect(await loginAt(`/login?next=${encodeURIComponent('//evil.example.com/x')}`)).toBe('/');
  });

  it('付いていなければトップへ (前と同じ)', async () => {
    expect(await loginAt('/login')).toBe('/');
  });
});
