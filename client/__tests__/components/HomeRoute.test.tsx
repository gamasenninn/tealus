/**
 * #494-2 (2026-10-04 UI 試験 4 周目): ゲストはログイン直後に空のホーム「お知らせはありません」を見ていた。
 * ホームは社内の画面で、ゲストにはタブも出さない (#282)。`/` はトーク一覧へ回す
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockUser: { role: string } | null = null;
vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: () => ({ user: mockUser }),
}));
vi.mock('../../src/components/home/HomePage', () => ({ default: () => <div>ホームの中身</div> }));

import HomeRoute from '../../src/components/home/HomeRoute';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/talk" element={<div>トーク一覧</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HomeRoute', () => {
  beforeEach(() => { mockUser = null; });

  it('★ ゲストはトーク一覧へ回す', () => {
    mockUser = { role: 'guest' };
    renderAt();
    expect(screen.getByText('トーク一覧')).toBeTruthy();
    expect(screen.queryByText('ホームの中身')).toBeNull();
  });

  it.each(['user', 'admin'])('%s はホームのまま', (role) => {
    mockUser = { role };
    renderAt();
    expect(screen.getByText('ホームの中身')).toBeTruthy();
  });
});
