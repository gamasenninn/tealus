/**
 * 転送後のトースト (2026-09-30)
 * ★ 部屋名・表示名は利用者が決める文字列なので、HTML としてでなく文字として入れる
 */
import { describe, it, expect, vi } from 'vitest';
import { buildForwardToast } from '../src/components/chat/forwardToast';

describe('buildForwardToast', () => {
  it('部屋名を文面に入れる', () => {
    const el = buildForwardToast('業務メモ', () => {});
    expect(el.textContent).toContain('「業務メモ」に転送しました');
    expect(el.className).toBe('forward-toast');
  });

  it('部屋名に HTML の記号があっても、要素にならず文字のまま出る', () => {
    const name = '<img src=x onerror="x()"><b>太字</b>';
    const el = buildForwardToast(name, () => {});
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain(name);
  });

  it('「開く」を押すと onOpen が呼ばれる', () => {
    const onOpen = vi.fn();
    const el = buildForwardToast('A', onOpen);
    const button = el.querySelector<HTMLButtonElement>('button.forward-toast-open');
    expect(button?.textContent).toBe('開く');
    button!.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
