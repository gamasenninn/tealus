/**
 * #504 マルチトークのパネルの「最小化 / 最大化 / 元に戻す」(純関数)。
 *
 * ★ 以前は「普通サイズ」ボタンが決まった大きさ (幅 500px) にするだけで、整列で並べた大きさや
 *   手で変えた大きさが失われていた。最小化・最大化は押し直すと「直前の位置と大きさ」に戻す
 *   (Windows のウィンドウと同じ)。最大化中に最小化して戻すと、最大化に戻る。
 */

export interface PanelGeom {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelWindowState extends PanelGeom {
  minimized?: boolean;
  maximized?: boolean;
  /** 最小化する直前 (最大化していたかも含む) */
  beforeMin?: PanelGeom & { maximized?: boolean };
  /** 最大化する直前 */
  beforeMax?: PanelGeom;
}

/** #503 最小化したパネルの高さ = 帯 (MultiTalk.css の 18px) + 枠線 上下 1px */
export const MINIMIZED_HEIGHT = 20;

const geomOf = (p: PanelGeom): PanelGeom => ({ x: p.x, y: p.y, width: p.width, height: p.height });

/** 整列・手でのリサイズの後: 新しい大きさが「普通」。最小化・最大化と戻す先は消す */
export function asNormal<T extends PanelWindowState>(p: T): T {
  return { ...p, minimized: false, maximized: false, beforeMin: undefined, beforeMax: undefined };
}

function unminimize<T extends PanelWindowState>(p: T): T {
  const b = p.beforeMin;
  return { ...p, ...(b ? geomOf(b) : {}), maximized: b?.maximized ?? p.maximized, minimized: false, beforeMin: undefined };
}

export function toggleMinimize<T extends PanelWindowState>(p: T): T {
  if (p.minimized) return unminimize(p);
  return { ...p, beforeMin: { ...geomOf(p), maximized: p.maximized }, height: MINIMIZED_HEIGHT, minimized: true };
}

/** @param area 最大化したときの位置と大きさ (パネルの置き場いっぱい) */
export function toggleMaximize<T extends PanelWindowState>(p: T, area: PanelGeom): T {
  const base = p.minimized ? unminimize(p) : p;
  if (p.maximized && !p.minimized) {
    // 最大化中 → 直前に戻す
    return { ...base, ...(base.beforeMax ? geomOf(base.beforeMax) : {}), maximized: false, beforeMax: undefined };
  }
  if (base.maximized) return base;   // 最小化を戻したら最大化だった
  return { ...base, beforeMax: geomOf(base), ...area, maximized: true };
}

/** 帯のダブルクリック: 最小化中なら戻す、それ以外は 最大化 ⇄ 元に戻す */
export function onBarDoubleClick<T extends PanelWindowState>(p: T, area: PanelGeom): T {
  return p.minimized ? toggleMinimize(p) : toggleMaximize(p, area);
}
