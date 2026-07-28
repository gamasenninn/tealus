/**
 * #356 実行中のバンドルが陳腐化しているかの判定。
 *
 * `__BUILD_ID__` は vite の define でビルド時に焼き込まれる (dev では未定義)。
 * サーバの `GET /api/version` が返す ID と突き合わせる。この fetch は Service Worker の
 * precache を通らないため、SW が古い画面を出していても真実が取れる。
 */

/** ビルド時に焼き込まれる定数 (dev では未定義なので typeof で守る) */
declare const __BUILD_ID__: string | undefined;

/** 実行中のバンドルのビルド ID。不明なら null */
export const BUILD_ID: string | null =
  typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : null;

/**
 * 自分が古いか。
 *
 * 誤検知すると更新バナーが出っぱなしになり、しかもユーザーには消しようがない。
 * 材料が揃っていて明確に食い違うときだけ true にし、不明な要素があれば false に倒す。
 */
export function isStale(own: string | null | undefined, server: string | null | undefined): boolean {
  const a = (own || '').trim();
  const b = (server || '').trim();
  if (!a || !b) return false;
  return a !== b;
}
