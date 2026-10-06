/**
 * マルチトークのパネルの上端が画面の外へ出ていた (2026-10-06)
 *
 * scrollIntoView は、いちばん近い入れ物だけでなく先祖の入れ物を全部動かす。パネル (同じオリジンの iframe) の中で
 * 「一番下へ」「引用の元へ」を呼ぶと、親の画面のパネルの入れ物まで動き、パネルの見出しが切れていた。
 * 動かすのは、いちばん近いスクロールの入れ物 (メッセージ欄) の中だけにする。
 */
import { describe, it, expect, vi } from 'vitest';
import { scrollIntoContainer, scrollableParent } from '../src/utils/scrollWithin';

/** 高さ 500・中身 3000 のスクロールする入れ物と、その中の要素 (入れ物の上端から 1200px、高さ 100) */
function setup(scrollTop = 0) {
  const outer = document.createElement('div');
  outer.style.overflowY = 'auto';
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  const el = document.createElement('div');
  box.appendChild(el); outer.appendChild(box); document.body.appendChild(outer);
  for (const [n, sh, ch] of [[outer, 900, 800], [box, 3000, 500]] as const) {
    Object.defineProperty(n, 'scrollHeight', { configurable: true, get: () => sh });
    Object.defineProperty(n, 'clientHeight', { configurable: true, get: () => ch });
  }
  box.scrollTop = scrollTop;
  box.getBoundingClientRect = () => ({ top: 100, height: 500 }) as DOMRect;
  el.getBoundingClientRect = () => ({ top: 100 + 1200 - scrollTop, height: 100 }) as DOMRect;
  box.scrollTo = vi.fn() as never;
  outer.scrollTo = vi.fn() as never;
  el.scrollIntoView = vi.fn();
  return { outer, box, el };
}

describe('scrollIntoContainer', () => {
  it('★ いちばん近いスクロールの入れ物を見つける', () => {
    const { box, el } = setup();
    expect(scrollableParent(el)).toBe(box);
  });

  it('★★ 動かすのは近い入れ物だけ。先祖の入れ物は動かさない (scrollIntoView も使わない)', () => {
    const { outer, box, el } = setup();
    scrollIntoContainer(el, { block: 'center', behavior: 'smooth' });
    expect(box.scrollTo).toHaveBeenCalledTimes(1);
    expect(outer.scrollTo).not.toHaveBeenCalled();
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it('center: 要素が入れ物の真ん中に来る位置へ', () => {
    const { box, el } = setup(0);
    scrollIntoContainer(el, { block: 'center', behavior: 'smooth' });
    // 1200 - (500 - 100) / 2 = 1000
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('いまのスクロール位置を足して計算する (途中までさかのぼっていても同じ位置へ)', () => {
    const { box, el } = setup(700);
    scrollIntoContainer(el, { block: 'center' });
    expect(box.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  });
});
