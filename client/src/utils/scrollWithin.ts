/**
 * いちばん近いスクロールの入れ物の中だけで動かす (2026-10-06)。
 *
 * ★ scrollIntoView は、いちばん近い入れ物だけでなく先祖の入れ物を全部動かす。マルチトークのパネル
 *   (同じオリジンの iframe) の中で「一番下へ」「引用の元へ」を呼ぶと、親の画面のパネルの入れ物まで動き、
 *   パネルの見出しが画面の外へ切れていた。メッセージ欄の中ではこちらを使うこと。
 */

/** いちばん近い、実際にスクロールする先祖 (無ければ null) */
export function scrollableParent(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** 入れ物を指定の位置へ動かす */
export function scrollContainerTo(container: HTMLElement, top: number, behavior: ScrollBehavior = 'auto'): void {
  if (typeof container.scrollTo === 'function') container.scrollTo({ top, behavior });
  else container.scrollTop = top;
}

/**
 * 要素が見える位置へ、いちばん近い入れ物だけを動かす。
 * ★ 入れ物が見つからなければ何もしない (ページ全体や親の画面を動かさない)
 */
export function scrollIntoContainer(
  el: Element,
  { block = 'center', behavior = 'auto' }: { block?: 'center' | 'start'; behavior?: ScrollBehavior } = {},
): void {
  const container = scrollableParent(el);
  if (!container) return;
  const er = el.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  const offset = er.top - cr.top + container.scrollTop;
  const top = block === 'center' ? offset - (container.clientHeight - er.height) / 2 : offset;
  scrollContainerTo(container, Math.max(0, top), behavior);
}
