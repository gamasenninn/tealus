/**
 * #502 マルチトーク: 一覧は左の RoomList 1 つだけ。MultiTalk は「開いて」を受け取ってパネルにする
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import MultiTalk from '../../src/components/multi/MultiTalk';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';
import { useAuthStore } from '../../src/stores/authStore';

function renderMulti() {
  return render(<MemoryRouter initialEntries={['/multi']}><MultiTalk /></MemoryRouter>);
}

beforeEach(() => {
  // jsdom に無い。PWA (standalone) でないときの値を返す
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;
  localStorage.removeItem('multiTalkPanels');
  useAuthStore.setState({ user: { id: 'me', role: 'user', display_name: '私' } } as never);
  useMultiTalkStore.setState({ pendingOpen: null, openRoomIds: [], sidebarHidden: false });
});

describe('MultiTalk (#502)', () => {
  it('★★ 内側の一覧 (「トーク」が 2 つ目) を持たない', () => {
    const { container } = renderMulti();
    expect(container.querySelector('.multi-sidebar')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'トーク' })).toBeNull();
  });

  it('★ 左の一覧からの「開いて」でパネルが増え、開いている部屋を店に知らせる', () => {
    const { container } = renderMulti();
    act(() => { useMultiTalkStore.getState().requestOpen({ id: 'r1', name: '営業' }); });
    expect([...container.querySelectorAll('.multi-panel-title')].map((e) => e.textContent)).toEqual(['営業']);
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('/rooms/r1?embed=true');
    expect(useMultiTalkStore.getState().openRoomIds).toEqual(['r1']);
    expect(useMultiTalkStore.getState().pendingOpen).toBeNull();
  });

  it('★ 同じ部屋をもう一度押しても、パネルは増えない', () => {
    const { container } = renderMulti();
    act(() => { useMultiTalkStore.getState().requestOpen({ id: 'r1', name: '営業' }); });
    act(() => { useMultiTalkStore.getState().requestOpen({ id: 'r1', name: '営業' }); });
    expect(container.querySelectorAll('.multi-panel')).toHaveLength(1);
  });

  it('★ パネルを閉じると、開いている部屋からも外れる', () => {
    const { container } = renderMulti();
    act(() => { useMultiTalkStore.getState().requestOpen({ id: 'r1', name: '営業' }); });
    fireEvent.click(container.querySelector('.multi-panel-close')!);
    expect(useMultiTalkStore.getState().openRoomIds).toEqual([]);
  });

  it('★ ツールバーのボタンで左の一覧を隠す / 出す', () => {
    renderMulti();
    fireEvent.click(screen.getByTitle('一覧を隠す'));
    expect(useMultiTalkStore.getState().sidebarHidden).toBe(true);
    fireEvent.click(screen.getByTitle('一覧を出す'));
    expect(useMultiTalkStore.getState().sidebarHidden).toBe(false);
  });

  it('前に開いていたパネル (localStorage) も、開いている部屋として知らせる', () => {
    localStorage.setItem('multiTalkPanels', JSON.stringify([{ id: 1, roomId: 'r9', roomName: '前の部屋', x: 0, y: 0, width: 400, height: 400 }]));
    renderMulti();
    expect(useMultiTalkStore.getState().openRoomIds).toEqual(['r9']);
  });
});
