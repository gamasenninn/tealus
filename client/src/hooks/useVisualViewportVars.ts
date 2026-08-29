import { useEffect } from 'react';

/**
 * 実際に見えている領域 (visual viewport) の高さ / 上端を CSS 変数に流す。
 *
 *   --vvh  見えている高さ   (キーボードが覆っている分を引いた実寸)
 *   --vvt  見えている上端   (iOS でページがずれたときのオフセット)
 *
 * ★ なぜ必要か (2026-08-29、Android で実測):
 *   モーダルの overlay は position:fixed + inset:0 で、基準はレイアウトビューポート。
 *   ソフトキーボードが出てもレイアウトビューポートは縮まないことがあるため、
 *   overlay の下端 (= 確定/キャンセルのボタン行) がキーボードの裏に入って押せなかった。
 *
 * ★ vh を当て推量で削る / rows を減らす は対症でしかない。理由は 2 つ:
 *   1. キーボードの高さは端末と IME で違う
 *   2. 本文の文字サイズが 12 / 15 / 19px 可変 (index.css) なので、同じ行数でも高さが違う
 *   → 実寸を CSS に渡して、CSS 側は「見えている分」を基準に組む。
 *
 * ★ 変数を「置かない」ことも要件。visualViewport の無い環境では CSS の fallback
 *   (100% = 従来どおり) に落ちてほしいので、0px 等を書き込まない。
 *
 * ★ interactive-widget=resizes-content (index.html) が効く環境では、
 *   レイアウトビューポート自体が縮むので --vvh は 100% と一致する。二重に縮まない。
 */
export function useVisualViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--vvh', `${vv.height}px`);
      root.style.setProperty('--vvt', `${vv.offsetTop}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, []);
}
