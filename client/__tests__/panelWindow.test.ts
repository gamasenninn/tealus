/**
 * マルチトークのパネルの帯のダブルクリック (2026-10-27 小野さん判断)
 * ★ 以前は最大化ボタンと同じ (最大化 ⇄ 元に戻す) で、ボタンと役目が重なっていた。
 *   ダブルクリックは「トーク 1 つが読みやすい大きさ」(幅 480・高さは置き場の半分、位置は今の場所) にする
 */
import { describe, it, expect } from 'vitest';
import { onBarDoubleClick, toggleMinimize, toggleMaximize, FIT_WIDTH } from '../src/components/multi/panelWindow';

const area = { x: 4, y: 4, width: 1600, height: 900 };

describe('帯のダブルクリック', () => {
  it('★★ 幅 480・高さは置き場の半分。位置は今の場所のまま', () => {
    const p = onBarDoubleClick({ x: 100, y: 50, width: 300, height: 200 }, area);
    expect(p).toMatchObject({ x: 100, y: 50, width: FIT_WIDTH, height: 450, maximized: false, minimized: false });
    expect(FIT_WIDTH).toBe(480);
  });

  it('★ 置き場からはみ出すなら中へ寄せる', () => {
    const p = onBarDoubleClick({ x: 1500, y: 800, width: 300, height: 200 }, area);
    expect(p.x + p.width).toBeLessThanOrEqual(area.x + area.width);
    expect(p.y + p.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it('★ 置き場が 480 より狭ければ置き場の幅に合わせる', () => {
    const p = onBarDoubleClick({ x: 10, y: 10, width: 300, height: 200 }, { x: 4, y: 4, width: 400, height: 600 });
    expect(p.width).toBe(400);
    expect(p.x).toBe(4);
  });

  it('★ 最大化中なら、最大化をやめて読みやすい大きさにする (位置は最大化する前の場所)', () => {
    const max = toggleMaximize({ x: 200, y: 100, width: 300, height: 200 }, area);
    const p = onBarDoubleClick(max, area);
    expect(p).toMatchObject({ x: 200, y: 100, width: FIT_WIDTH, height: 450, maximized: false, beforeMax: undefined });
  });

  it('最小化中なら今どおり元に戻す', () => {
    const min = toggleMinimize({ x: 100, y: 50, width: 300, height: 200 });
    expect(onBarDoubleClick(min, area)).toMatchObject({ x: 100, y: 50, width: 300, height: 200, minimized: false });
  });
});
