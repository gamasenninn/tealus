/**
 * 部屋の入力欄を出すか。
 * ★ #494-3 部屋を開けなかった (入っていない・消えた) ときは出さない。送ってもサーバーが捨てるので、書いた文が黙って消える
 */
export function showComposer(roomError: string | null): boolean {
  return !roomError;
}
