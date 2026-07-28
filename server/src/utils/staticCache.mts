/**
 * #355 静的配信の Cache-Control 方針。
 *
 * express 既定の `public, max-age=0` は「毎回再検証して」であって「保存するな」では
 * ない。iOS WebKit がこれを守らず古い index.html を返すと、そこに書かれた古いハッシュの
 * JS を読みに行くため更新が一切反映されなくなる (iPhone の PWA で実際に発生)。
 *
 * 更新の入口は保存自体を禁じ、内容ハッシュ付きの資産は逆に長期キャッシュにする。
 * 現状は全部 max-age=0 で毎回再検証しているので、後者は素の読み込みも軽くなる。
 */

/** 更新の入口。いずれも小さく、毎回取り直しても損がない */
export const NO_STORE = 'no-store, must-revalidate';

/** 内容ハッシュ付き資産。中身が変われば URL が変わるので再検証すら要らない */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * 更新の入口となるファイル名。ここが古いままだと他を何度取り直しても意味がない。
 * workbox-*.js はハッシュ付きだが SW ランタイムなので保守的に no-store 側に置く。
 */
const ENTRY_POINT = /^(index\.html|sw\.js|registerSW\.js|custom-sw\.js|workbox-[^/\\]*\.js|[^/\\]*\.webmanifest)$/i;

/**
 * 配信するファイルのパスから Cache-Control を決める。
 * null は「指定しない」= express 既定に任せる (アイコン等)。
 *
 * @param filePath 絶対/相対いずれも可。区切り文字は OS 依存でよい
 */
export function cacheControlFor(filePath: string): string | null {
  const segments = filePath.split(/[\\/]/);
  const name = segments[segments.length - 1] || '';

  // 入口判定を先に置く: ビルド構成が変わって assets 配下に出ても長期キャッシュにしない
  if (ENTRY_POINT.test(name)) return NO_STORE;

  // ディレクトリ名が厳密に 'assets' のときだけ (media/assets-2026 等を巻き込まない)
  if (segments.slice(0, -1).includes('assets')) return IMMUTABLE;

  return null;
}

/**
 * express.static の setHeaders / sendFile 用。res は最小限の形だけ要求する
 * (Response 型に依存させないことで dashboard 側からも同じ関数を使える)。
 */
export function applyStaticCacheHeaders(res: { setHeader(name: string, value: string): void }, filePath: string): void {
  const value = cacheControlFor(filePath);
  if (value) res.setHeader('Cache-Control', value);
}
