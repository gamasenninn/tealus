/**
 * #485-6 部屋の一覧の右クリック (長押し) メニューが Esc で閉じなかった。外をクリックすれば閉じる作りだけだった
 */
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEscapeToClose } from '../../src/hooks/useEscapeToClose';

describe('useEscapeToClose (#485-6)', () => {
  it('開いているとき Esc で閉じる', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(true, onClose));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('閉じているときは何もしない', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(false, onClose));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc 以外のキーでは閉じない', () => {
    const onClose = vi.fn();
    renderHook(() => useEscapeToClose(true, onClose));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('閉じたら聞くのをやめる (unmount 後に呼ばれない)', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscapeToClose(true, onClose));
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
