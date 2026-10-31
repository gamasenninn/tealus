import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/** 正規表現の後読み (?<=…) を使えるか。Safari は 16.4 から (改善ループ 31) */
export function supportsLookbehind(): boolean {
  try {
    new RegExp('(?<=a)b');
    return true;
  } catch {
    return false;
  }
}

/**
 * 投稿・ホーム・テキストの表示で使う Markdown の部品。
 * ★ remark-gfm のメールの自動リンクは描画のたびに後読みの正規表現を作る。後読みを持たない古い Safari では
 *   その場で例外になり、ホーム画面ごと「画面の表示で問題が起きました」になっていた (10-29・10-30 に Safari 15.4)。
 *   使えない環境では remark-gfm を外す (表と自動リンクが効かないだけで、本文と改行は出る)
 */
export function markdownPlugins(lookbehind = supportsLookbehind()) {
  return lookbehind ? [remarkGfm, remarkBreaks] : [remarkBreaks];
}

export const MARKDOWN_PLUGINS = markdownPlugins();
