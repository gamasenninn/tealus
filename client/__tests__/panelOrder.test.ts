/**
 * マルチトークのパネルを、ドラッグで並びの好きな位置へ差し込む (利用者の提案 2026-10-06)
 *
 * パネルは自由に動かせたが、並び順 (= 整列したときの順番 = 優先度) は変えられなかった。
 * 別のパネルの上で離したら、その左 (前) か右 (後ろ) に差し込み、今の整列のやり方で並べ直す。
 * 何もない所で離したときは今までどおり自由に置く。
 */
import { describe, it, expect } from 'vitest';
import { findInsertTarget, insertPanel, layoutPanels } from '../src/components/multi/panelOrder';

// 横並び 4 枚 (幅 200、間 8): A=4..204 B=212..412 C=420..620 D=628..828
import type { PanelWindowState } from '../src/components/multi/panelWindow';
const p = (id: number, x: number, extra: Partial<PanelWindowState> = {}): PanelWindowState & { id: number } => ({ id, x, y: 4, width: 200, height: 600, ...extra });
const four = () => [p(1, 4), p(2, 212), p(3, 420), p(4, 628)];

describe('findInsertTarget — どのパネルのどちら側に落としたか', () => {
  it('★ 相手の左半分なら前、右半分なら後ろ', () => {
    expect(findInsertTarget(four(), 4, { x: 250, y: 100 })).toEqual({ targetId: 2, side: 'before' });
    expect(findInsertTarget(four(), 4, { x: 380, y: 100 })).toEqual({ targetId: 2, side: 'after' });
  });

  it('★ 何もない所なら null (今までどおり自由に置く)', () => {
    expect(findInsertTarget(four(), 4, { x: 900, y: 100 })).toBeNull();
    expect(findInsertTarget(four(), 4, { x: 208, y: 100 })).toBeNull();   // パネルの間の隙間
  });

  it('自分自身の上では null', () => {
    expect(findInsertTarget(four(), 2, { x: 250, y: 100 })).toBeNull();
  });

  it('★ 最小化・最大化しているパネルは相手にしない', () => {
    const ps = [p(1, 4, { minimized: true }), p(2, 212, { maximized: true }), p(3, 420)];
    expect(findInsertTarget(ps, 3, { x: 50, y: 10 })).toBeNull();
    expect(findInsertTarget(ps, 3, { x: 250, y: 100 })).toBeNull();
  });

  it('重なっているときは上に描かれている方 (後ろの要素) を相手にする', () => {
    const ps = [p(1, 4), p(2, 100), p(3, 628)];
    expect(findInsertTarget(ps, 3, { x: 150, y: 100 })?.targetId).toBe(2);
  });
});

describe('insertPanel — 並びに差し込む', () => {
  const ids = (ps: Array<{ id: number }>) => ps.map((x) => x.id);

  it('★ D を B の前へ → A D B C', () => {
    expect(ids(insertPanel(four(), 4, { targetId: 2, side: 'before' }))).toEqual([1, 4, 2, 3]);
  });

  it('★ A を C の後ろへ → B C A D', () => {
    expect(ids(insertPanel(four(), 1, { targetId: 3, side: 'after' }))).toEqual([2, 3, 1, 4]);
  });

  it('すでにその位置なら並びは変わらない', () => {
    expect(ids(insertPanel(four(), 2, { targetId: 3, side: 'before' }))).toEqual([1, 2, 3, 4]);
  });

  it('元の配列は書き換えない', () => {
    const ps = four();
    insertPanel(ps, 4, { targetId: 1, side: 'before' });
    expect(ids(ps)).toEqual([1, 2, 3, 4]);
  });
});

describe('layoutPanels — 並び順どおりに配置する (整列と同じ計算)', () => {
  it('★ 横並び: 並び順に左から', () => {
    const ps = insertPanel(four(), 4, { targetId: 2, side: 'before' });   // A D B C
    const out = layoutPanels(ps, 'columns', 840, 700);
    expect(out.map((x) => [x.id, x.x])).toEqual([[1, 4], [4, 214], [2, 424], [3, 634]]);
    expect(out.every((x) => x.y === 4 && x.height === 692)).toBe(true);
  });

  it('★ タイル: 左上から右へ、行が終わったら次の段', () => {
    const out = layoutPanels(four(), 'tile', 808, 608);   // 2 列 × 2 段、各 396 × 296
    expect(out.map((x) => [x.id, x.x, x.y])).toEqual([[1, 4, 4], [2, 408, 4], [3, 4, 308], [4, 408, 308]]);
  });

  it('最小化・最大化は解いて普通の大きさにする (整列と同じ)', () => {
    const ps = [p(1, 4, { minimized: true, beforeMin: { x: 0, y: 0, width: 1, height: 1 } }), p(2, 212)];
    const out = layoutPanels(ps, 'columns', 840, 700);
    expect(out[0].minimized).toBeFalsy();
    expect(out[0].beforeMin).toBeUndefined();
  });
});
