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
    expect(container.querySelector('iframe')?.getAttribute('title')).toBe('営業');
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

/**
 * #503 パネルの見出しが 2 段で、部屋の名前が 2 回出ていた (帯 + 中の見出し)。
 * ★ 帯はドラッグのつかみなので消せない (中身は iframe)。名前だけ外し、最小化したときだけ出す
 */
describe('MultiTalk — パネルの帯 (#503)', () => {
  function openOne() {
    const r = renderMulti();
    act(() => { useMultiTalkStore.getState().requestOpen({ id: 'r1', name: '営業' }); });
    return r;
  }

  it('★★ 普通のパネルでは、帯に名前を出さない (名前は中の見出しだけ)', () => {
    const { container } = openOne();
    expect(container.querySelector('.multi-panel-title')).toBeNull();
    expect(container.querySelector('.multi-panel-grip')).not.toBeNull();
  });

  it('★ 帯に触れたら名前が出る / 読み上げ用の名前がある', () => {
    const { container } = openOne();
    const bar = container.querySelector('.multi-panel-header')!;
    expect(bar.getAttribute('title')).toBe('営業');
    expect(bar.getAttribute('aria-label')).toBe('営業');
  });

  it('★★★ 最小化すると本当に帯だけの高さになる (最小の高さ 300px に引き戻されていた)', () => {
    const { container } = openOne();
    fireEvent.click(screen.getByTitle('最小化'));
    const wrap = container.querySelector('.multi-panel')!.parentElement as HTMLElement;
    expect(wrap.style.height).toBe('20px');
    // ★ react-rnd は minHeight を CSS の min-height にする。高さだけ 20 にしても min-height 300 で引き戻されていた
    expect(parseInt(wrap.style.minHeight || '0', 10)).toBeLessThanOrEqual(20);
  });

  it('★★ 最小化すると帯に名前が出て、普通サイズに戻すと消える', () => {
    const { container } = openOne();
    fireEvent.click(screen.getByTitle('最小化'));
    expect(container.querySelector('.multi-panel-title')?.textContent).toBe('営業');
    fireEvent.click(screen.getByTitle('普通サイズ'));
    expect(container.querySelector('.multi-panel-title')).toBeNull();
  });
});
