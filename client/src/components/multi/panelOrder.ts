/**
 * マルチトークのパネルの並び順 (純関数、2026-10-06)。
 *
 * ★ パネルは自由に動かせたが、並び順 (= 整列したときの順番 = 優先度) は変えられなかった。
 *   別のパネルの上で離したら、その前か後ろに差し込み、今の整列のやり方で並べ直す (利用者の提案)。
 *   何もない所で離したときは今までどおり自由に置く。
 */
import { asNormal, type PanelWindowState } from './panelWindow';

export type InsertSide = 'before' | 'after';
export interface InsertHint { targetId: number; side: InsertSide }
export type LayoutMode = 'tile' | 'columns';

type Panel = PanelWindowState & { id: number };

/**
 * 落とした点 (パネルの置き場の座標) が、どのパネルのどちら側か。相手の左半分なら前、右半分なら後ろ。
 * ★ 最小化・最大化しているパネルは相手にしない (帯だけ・置き場いっぱいのものの前後は決めにくい)。
 * ★ 重なっているときは上に描かれている方 (配列の後ろ) を相手にする
 */
export function findInsertTarget(panels: Panel[], draggedId: number, pt: { x: number; y: number }): InsertHint | null {
  for (let i = panels.length - 1; i >= 0; i--) {
    const p = panels[i];
    if (p.id === draggedId || p.minimized || p.maximized) continue;
    if (pt.x >= p.x && pt.x < p.x + p.width && pt.y >= p.y && pt.y < p.y + p.height) {
      return { targetId: p.id, side: pt.x < p.x + p.width / 2 ? 'before' : 'after' };
    }
  }
  return null;
}

/** 動かしたパネルを、相手の前か後ろへ差し込んだ新しい並び (元の配列は書き換えない) */
export function insertPanel<T extends { id: number }>(panels: T[], draggedId: number, hint: InsertHint): T[] {
  const dragged = panels.find((p) => p.id === draggedId);
  if (!dragged || draggedId === hint.targetId) return panels.slice();
  const rest = panels.filter((p) => p.id !== draggedId);
  const at = rest.findIndex((p) => p.id === hint.targetId);
  if (at < 0) return panels.slice();
  rest.splice(hint.side === 'before' ? at : at + 1, 0, dragged);
  return rest;
}

/**
 * 並び順どおりに配置する (整列のボタンと同じ計算)。タイルは左上から右へ、行が終わったら次の段。
 * ★ 整列したら新しい大きさが「普通」(最小化・最大化と戻す先は消す、#504)
 */
export function layoutPanels<T extends PanelWindowState>(panels: T[], mode: LayoutMode, cw: number, ch: number): T[] {
  if (panels.length === 0) return panels;
  if (mode === 'columns') {
    const w = Math.floor(cw / panels.length) - 8;
    return panels.map((p, i) => ({ ...asNormal(p), x: i * (w + 8) + 4, y: 4, width: w, height: ch - 8 }));
  }
  const cols = Math.ceil(Math.sqrt(panels.length));
  const rows = Math.ceil(panels.length / cols);
  const w = Math.floor(cw / cols) - 8;
  const h = Math.floor(ch / rows) - 8;
  return panels.map((p, i) => ({
    ...asNormal(p),
    x: (i % cols) * (w + 8) + 4,
    y: Math.floor(i / cols) * (h + 8) + 4,
    width: w,
    height: h,
  }));
}
