/**
 * #509 親も同じ Tealus の画面 (マルチトークのパネル) の中で動いているか。
 *
 * ★ 別のサイトに埋め込まれた Tealus は false (そこでの通知まで止めない)。
 *   別のサイトの親は location を読むと例外になるので、読めなければ false。
 */
export function isEmbeddedInSameApp(win: Window = window): boolean {
  try {
    if (!win.top || win.top === win) return false;
    return win.top.location.origin === win.location.origin;
  } catch {
    return false;
  }
}
