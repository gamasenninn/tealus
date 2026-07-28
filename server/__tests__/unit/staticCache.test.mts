/**
 * #355 静的配信の Cache-Control 方針
 *
 * iOS PWA に更新が反映されない件の根本策。express 既定の `public, max-age=0` は
 * 「毎回再検証して」であって「保存するな」ではないため、WebKit がこれを守らないと
 * 古い index.html が使われ、そこに書かれた古いハッシュの JS を読みに行ってしまう。
 *
 * 更新の入口 (index.html / sw / manifest) は no-store、内容ハッシュ付きの
 * /assets/* は逆に immutable で長期キャッシュ、と性質で分ける。
 */
import path from 'path';
import { cacheControlFor, NO_STORE, IMMUTABLE } from '../../src/utils/staticCache.mts';

/** OS 依存の区切り文字で組む (Windows / POSIX どちらでも同じ判定になること自体が要件) */
const p = (...parts: string[]) => parts.join(path.sep);

describe('cacheControlFor — 更新の入口は no-store', () => {
  it('index.html', () => {
    expect(cacheControlFor(p('client', 'dist', 'index.html'))).toBe(NO_STORE);
  });

  it('service worker 本体と登録スクリプト', () => {
    expect(cacheControlFor(p('client', 'dist', 'sw.js'))).toBe(NO_STORE);
    expect(cacheControlFor(p('client', 'dist', 'registerSW.js'))).toBe(NO_STORE);
    expect(cacheControlFor(p('client', 'dist', 'custom-sw.js'))).toBe(NO_STORE);
  });

  it('manifest', () => {
    expect(cacheControlFor(p('client', 'dist', 'manifest.webmanifest'))).toBe(NO_STORE);
  });

  it('workbox ランタイム (ハッシュ付きだが SW 系なので保守的に no-store)', () => {
    expect(cacheControlFor(p('client', 'dist', 'workbox-8c29f6e4.js'))).toBe(NO_STORE);
  });
});

describe('cacheControlFor — 内容ハッシュ付き資産は immutable', () => {
  it('assets 配下の js / css', () => {
    expect(cacheControlFor(p('client', 'dist', 'assets', 'index-CePZ7L9A.js'))).toBe(IMMUTABLE);
    expect(cacheControlFor(p('client', 'dist', 'assets', 'index-BWG3ceAd.css'))).toBe(IMMUTABLE);
  });

  it('ダッシュボード側の assets も同じ扱い', () => {
    expect(cacheControlFor(p('dashboard', 'dist', 'assets', 'main-abc123.js'))).toBe(IMMUTABLE);
  });

  it('assets 配下でも sw 系の名前なら no-store を優先する', () => {
    // ビルド構成が変わって assets 配下に出ても、更新の入口を長期キャッシュにしない
    expect(cacheControlFor(p('dist', 'assets', 'sw.js'))).toBe(NO_STORE);
  });
});

describe('cacheControlFor — それ以外は指定しない', () => {
  it('アイコンやその他の静的ファイルは express 既定に任せる (null)', () => {
    expect(cacheControlFor(p('client', 'dist', 'icons', 'icon-192.png'))).toBeNull();
    expect(cacheControlFor(p('client', 'dist', 'favicon.ico'))).toBeNull();
  });

  it('assets という語が途中に出るだけのパスは immutable にしない', () => {
    // /media/assets-2026/foo.png のような無関係なパスを巻き込まない
    expect(cacheControlFor(p('media', 'assets-2026', 'foo.png'))).toBeNull();
  });

  it('POSIX 区切りのパスでも同じ判定になる', () => {
    expect(cacheControlFor('client/dist/assets/index-CePZ7L9A.js')).toBe(IMMUTABLE);
    expect(cacheControlFor('client/dist/index.html')).toBe(NO_STORE);
  });
});

describe('ヘッダー値', () => {
  it('no-store は保存自体を禁じる (max-age=0 の再検証任せにしない)', () => {
    expect(NO_STORE).toContain('no-store');
  });

  it('immutable は 1 年 + immutable', () => {
    expect(IMMUTABLE).toBe('public, max-age=31536000, immutable');
  });
});
