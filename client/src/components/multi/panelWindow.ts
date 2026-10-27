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

/** 帯のダブルクリックで開く「トーク 1 つが読みやすい」幅の下限 (これより広ければその幅のまま。高さは置き場の半分) */
export const FIT_WIDTH = 480;

/**
 * 帯のダブルクリック: 最小化中なら戻す、それ以外は「読みやすい大きさ」(幅は 480 以上なら今のまま・狭ければ 480、高さは置き場の半分、位置は今の場所)。
 * ★ 2026-10-27 小野さん判断。以前は 最大化 ⇄ 元に戻す で、最大化ボタンと役目が重なっていた。
 *   最大化中なら最大化する前の場所を起点にする。置き場からはみ出すなら中へ寄せる
 */
export function onBarDoubleClick<T extends PanelWindowState>(p: T, area: PanelGeom): T {
  if (p.minimized) return toggleMinimize(p);
  const from = p.maximized && p.beforeMax ? p.beforeMax : p;
  const width = Math.min(Math.max(FIT_WIDTH, from.width), area.width);   // ★ 十分広ければそのまま (小野さん、2026-10-27)
  const height = Math.round(area.height / 2);
  const x = Math.max(area.x, Math.min(from.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(from.y, area.y + area.height - height));
  return { ...asNormal(p), x, y, width, height };
}
