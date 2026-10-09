/**
 * #502 マルチトーク: 一覧は左の RoomList 1 つだけ。MultiTalk は「開いて」を受け取ってパネルにする
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach } from 'vitest';
import MultiTalk from '../../src/components/multi/MultiTalk';
import { useMultiTalkStore } from '../../src/stores/multiTalkStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useRoomStore } from '../../src/stores/roomStore';

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
    fireEvent.click(screen.getByTitle('元に戻す'));
    expect(container.querySelector('.multi-panel-title')).toBeNull();
  });
});

/**
 * #504 最小化・最大化は押し直して戻す / 帯のダブルクリック / 「普通サイズ」ボタンは無くす
 * ★ 「普通サイズ」は決まった大きさにするだけで、整列で並べた大きさが失われていた。戻す先は直前の状態
 */
describe('MultiTalk — 元に戻す (#504)', () => {
  const start = { id: 1, roomId: 'r1', roomName: '営業', x: 10, y: 20, width: 400, height: 500 };
  const saved = () => JSON.parse(localStorage.getItem('multiTalkPanels')!)[0];
  const geom = () => { const p = saved(); return { x: p.x, y: p.y, width: p.width, height: p.height }; };
  const startGeom = { x: 10, y: 20, width: 400, height: 500 };
  function renderOne() {
    localStorage.setItem('multiTalkPanels', JSON.stringify([start]));
    return renderMulti();
  }

  it('★ 「普通サイズ」ボタンは無い', () => {
    renderOne();
    expect(screen.queryByTitle('普通サイズ')).toBeNull();
  });

  it('★★ 最小化 → もう一度押すと、直前の位置と大きさに戻る', () => {
    renderOne();
    fireEvent.click(screen.getByTitle('最小化'));
    expect(saved().minimized).toBe(true);
    fireEvent.click(screen.getByTitle('元に戻す'));
    expect(saved().minimized).toBeFalsy();
    expect(geom()).toEqual(startGeom);
  });

  it('★★ 最大化 → もう一度押すと、直前の位置と大きさに戻る', () => {
    renderOne();
    fireEvent.click(screen.getByTitle('最大化'));
    expect(saved().maximized).toBe(true);
    fireEvent.click(screen.getByTitle('元に戻す'));
    expect(saved().maximized).toBeFalsy();
    expect(geom()).toEqual(startGeom);
  });

  it('★ 帯のダブルクリックで 最大化 ⇄ 元に戻す', () => {
    const { container } = renderOne();
    fireEvent.doubleClick(container.querySelector('.multi-panel-header')!);
    expect(saved().maximized).toBe(true);
    fireEvent.doubleClick(container.querySelector('.multi-panel-header')!);
    expect(saved().maximized).toBeFalsy();
    expect(geom()).toEqual(startGeom);
  });

  it('★ 最小化中に帯をダブルクリックすると元に戻す', () => {
    const { container } = renderOne();
    fireEvent.click(screen.getByTitle('最小化'));
    fireEvent.doubleClick(container.querySelector('.multi-panel-header')!);
    expect(saved().minimized).toBeFalsy();
    expect(geom()).toEqual(startGeom);
  });

  it('★ 最大化中に最小化して戻すと、最大化に戻る (最小化する直前の状態)。そこからもう一度で最初へ', () => {
    renderOne();
    fireEvent.click(screen.getByTitle('最大化'));
    const maxGeom = geom();
    fireEvent.click(screen.getByTitle('最小化'));
    fireEvent.click(screen.getAllByTitle('元に戻す')[0]);   // 最小化を戻すボタン (左)
    expect(saved().minimized).toBeFalsy();
    expect(saved().maximized).toBe(true);
    expect(geom()).toEqual(maxGeom);
    fireEvent.click(screen.getByTitle('元に戻す'));
    expect(geom()).toEqual(startGeom);
  });

  it('★ ボタンのダブルクリックは帯へ伝わらない (最大化が勝手に切り替わらない)', () => {
    renderOne();
    fireEvent.doubleClick(screen.getByTitle('閉じる'));
    expect(saved().maximized).toBeFalsy();
  });

  it('帯を 1 回クリックしただけでは最小化は解けない (つかみなので)', () => {
    const { container } = renderOne();
    fireEvent.click(screen.getByTitle('最小化'));
    fireEvent.click(container.querySelector('.multi-panel-header')!);
    expect(saved().minimized).toBe(true);
  });
});

/**
 * #507 ツールバーの「すべて最下部へ」: 開いている全パネル (iframe) へ一度に一番下へ合わせる合図を送る
 */
describe('MultiTalk — すべて最下部へ (#507)', () => {
  it('★★ 開いている全パネルの中の画面へ scroll:bottom (instant) を送る', () => {
    localStorage.setItem('multiTalkPanels', JSON.stringify([
      { id: 1, roomId: 'r1', roomName: '営業', x: 0, y: 0, width: 400, height: 400 },
      { id: 2, roomId: 'r2', roomName: '整備', x: 400, y: 0, width: 400, height: 400, minimized: true },
    ]));
    const { container } = renderMulti();
    const got: unknown[] = [];
    container.querySelectorAll('iframe').forEach(f => {
      f.contentWindow!.addEventListener('scroll:bottom', (e) => got.push((e as CustomEvent).detail));
    });
    fireEvent.click(screen.getByTitle('すべて最下部へ'));
    expect(got).toEqual([{ instant: true }, { instant: true }]);
  });

  it('パネルが無くても押せる (何も起きない)', () => {
    renderMulti();
    expect(() => fireEvent.click(screen.getByTitle('すべて最下部へ'))).not.toThrow();
  });
});

/**
 * ★ 2026-10-09 利用者の報告: 整列した上に新しいトークを開き、そのまま閉じると、残りのパネルの間に隙間ができた。
 *   閉じるボタンは帯 (ドラッグのつかみ) の中にあり、押して離すだけで「ドラッグして離した」扱いになって、
 *   下のパネルの上 → 差し込み + 3 枚分の並べ直し → その直後に閉じて 2 枚 = 3 枚分の隙間が残っていた
 */
describe('MultiTalk — 閉じる・クリックでは並べ直さない', () => {
  const tiled = [
    { id: 1, roomId: 'r1', roomName: '営業', x: 0, y: 0, width: 600, height: 800 },
    { id: 2, roomId: 'r2', roomName: '整備', x: 600, y: 0, width: 600, height: 800 },
    // 整列せずに開いた新しいパネル (営業の上に重なっている)
    { id: 3, roomId: 'r3', roomName: '新しい', x: 20, y: 20, width: 500, height: 700 },
  ];
  const saved = () => JSON.parse(localStorage.getItem('multiTalkPanels') || '[]') as Array<{ id: number; x: number; y: number; width: number; height: number }>;
  const geomOf = (id: number) => { const p = saved().find((x) => x.id === id)!; return { x: p.x, y: p.y, width: p.width, height: p.height }; };
  const panelOf = (container: HTMLElement, title: string) => container.querySelector(`iframe[title="${title}"]`)!.closest('.multi-panel') as HTMLElement;

  beforeEach(() => localStorage.setItem('multiTalkPanels', JSON.stringify(tiled)));

  it('★★ 閉じるボタンを押して離しても、残りのパネルは動かない', () => {
    const { container } = renderMulti();
    const close = panelOf(container, '新しい').querySelector('.multi-panel-close')!;
    fireEvent.mouseDown(close, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(close, { clientX: 100, clientY: 100 });
    fireEvent.click(close);
    expect(saved().map((p) => p.id)).toEqual([1, 2]);
    expect(geomOf(1)).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(geomOf(2)).toEqual({ x: 600, y: 0, width: 600, height: 800 });
  });

  it('★ 帯をクリックしただけ (動かさない) でも、差し込み・並べ直しをしない', () => {
    const { container } = renderMulti();
    const bar = panelOf(container, '新しい').querySelector('.multi-panel-header')!;
    fireEvent.mouseDown(bar, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(bar, { clientX: 100, clientY: 100 });
    expect(saved().map((p) => p.id)).toEqual([1, 2, 3]);
    expect(geomOf(1)).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(geomOf(3)).toEqual({ x: 20, y: 20, width: 500, height: 700 });
  });

  it('★ 本当に動かして別のパネルの上で離したら、今までどおり差し込む (10-06 の機能を壊さない)', () => {
    const { container } = renderMulti();
    const bar = panelOf(container, '新しい').querySelector('.multi-panel-header')!;
    fireEvent.mouseDown(bar, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 400, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 700, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 700, clientY: 100 });
    // 整備 (600〜1200) の左半分で離した → 整備の前へ
    expect(saved().map((p) => p.id)).toEqual([1, 3, 2]);
  });
});

/**
 * ★ #535 パネルは開いたときの部屋の名前を覚えていて、改名しても最小化した帯 (と title) が古い名前のままだった
 */
describe('MultiTalk — 部屋の改名をパネルの名前に反映', () => {
  it('★ 一覧の部屋の名前が変わったら、パネルの名前も変わる', () => {
    localStorage.setItem('multiTalkPanels', JSON.stringify([
      { id: 1, roomId: 'r1', roomName: '古い名前', x: 0, y: 0, width: 400, height: 400, minimized: true },
    ]));
    useRoomStore.setState({ rooms: [{ id: 'r1', type: 'group', name: '新しい名前' }] as never });
    const { container } = renderMulti();
    expect(container.querySelector('.multi-panel-title')?.textContent).toBe('新しい名前');
    expect(JSON.parse(localStorage.getItem('multiTalkPanels')!)[0].roomName).toBe('新しい名前');
  });

  it('1 対 1 (名前の無い部屋) の名前は変えない', () => {
    localStorage.setItem('multiTalkPanels', JSON.stringify([
      { id: 1, roomId: 'd1', roomName: '田中', x: 0, y: 0, width: 400, height: 400, minimized: true },
    ]));
    useRoomStore.setState({ rooms: [{ id: 'd1', type: 'direct', name: null }] as never });
    const { container } = renderMulti();
    expect(container.querySelector('.multi-panel-title')?.textContent).toBe('田中');
  });
});
