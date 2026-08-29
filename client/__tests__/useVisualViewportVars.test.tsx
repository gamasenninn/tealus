import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * 実際に見えている領域 (visual viewport) を CSS 変数に流すフック。
 *
 * ★ 目的は「キーボードで隠れている分を CSS から引けるようにする」こと。
 *   スマホの編集モーダルは overlay が position:fixed + レイアウトビューポート基準のため、
 *   キーボードが出ても overlay の高さが変わらず、下端 (確定/キャンセル) が画面外に出ていた
 *   (2026-08-29 Android で実測)。vh を当て推量で削るのではなく、実寸を CSS に渡す。
 *
 * ★ 変数を「置かない」ことも要件。visualViewport が無い環境では CSS 側の fallback
 *   (100% = 従来どおり) に落とす必要があるので、0px 等を書き込んではいけない。
 */

const { useVisualViewportVars } = await import('../src/hooks/useVisualViewportVars');

type Listener = () => void;

function installVisualViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, Listener[]> = { resize: [], scroll: [] };
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: Listener) => { listeners[type]?.push(fn); },
    removeEventListener: (type: string, fn: Listener) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true, writable: true });
  return {
    vv,
    listeners,
    emit(type: string) { (listeners[type] || []).forEach((f) => f()); },
    count() { return listeners.resize.length + listeners.scroll.length; },
  };
}

function readVar(name: string) {
  return document.documentElement.style.getPropertyValue(name);
}

describe('useVisualViewportVars', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--vvh');
    document.documentElement.style.removeProperty('--vvt');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport');
    vi.restoreAllMocks();
  });

  it('マウント時に 見えている高さと上端を CSS 変数へ入れる', () => {
    installVisualViewport(575, 0);
    renderHook(() => useVisualViewportVars());
    expect(readVar('--vvh')).toBe('575px');
    expect(readVar('--vvt')).toBe('0px');
  });

  it('★ キーボードが出て縮んだら 追従する (resize)', () => {
    const h = installVisualViewport(915, 0);
    renderHook(() => useVisualViewportVars());
    expect(readVar('--vvh')).toBe('915px');

    act(() => {
      h.vv.height = 575; // キーボードが 340px ぶん覆った
      h.emit('resize');
    });
    expect(readVar('--vvh')).toBe('575px');
  });

  it('★ ページがずれたら 上端も追従する (scroll)', () => {
    const h = installVisualViewport(575, 0);
    renderHook(() => useVisualViewportVars());

    act(() => {
      h.vv.offsetTop = 120;
      h.emit('scroll');
    });
    expect(readVar('--vvt')).toBe('120px');
  });

  it('★ visualViewport が無い環境では 変数を置かない (CSS の fallback に落とす)', () => {
    Reflect.deleteProperty(window, 'visualViewport');
    expect(() => renderHook(() => useVisualViewportVars())).not.toThrow();
    expect(readVar('--vvh')).toBe('');
    expect(readVar('--vvt')).toBe('');
  });

  it('アンマウントで listener を外す', () => {
    const h = installVisualViewport(575);
    const { unmount } = renderHook(() => useVisualViewportVars());
    expect(h.count()).toBeGreaterThan(0);
    unmount();
    expect(h.count()).toBe(0);
  });
});
