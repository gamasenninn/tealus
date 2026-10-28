/**
 * 画像のサムネイルは、写真の向きの印 (EXIF の Orientation) に従う (2026-10-28 小野さん判断 B)
 *
 * ★ sharp は既定で印を見ず、出力から EXIF も落とすので、縦に構えて撮った写真のサムネイルが横倒しになっていた
 *   (10-27 改善ループ 19 回目)。開いて大きく見たときはブラウザが印に従うので、サムネイルと向きが食い違っていた。
 * ★ 10-28 午前に一度「印を無視」(A) に戻した。机の上で平らに撮った書類はスマホが印を誤って付ける (真下に向けると
 *   1 と 6 がばらつく) ため。だが A ではサムネイルは正しいのに開くと回る、の食い違いで誤りが隠れる。
 *   印に従えば、サムネイルと開いたときがいつも同じで、撮り方を誤ればその場で見えて撮り直せる —— を選んだ (撮り方は人が気をつける)
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateThumbnail } from '../../src/services/thumbnail.mts';
import { MEDIA_ROOT } from '../../src/middleware/upload.mts';

describe('画像のサムネイルは写真の向きの印に従う', () => {
  const src = path.join(MEDIA_ROOT, 'images', `orient-test-${process.pid}.jpg`);
  let thumbRel: string | null = null;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.mkdirSync(path.join(MEDIA_ROOT, 'thumbnails'), { recursive: true });
    // 横長 (40x20) に保存し、「90 度回して見せる」(Orientation 6) の印を付ける = 縦に構えて撮った写真の形
    await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .jpeg().withMetadata({ orientation: 6 }).toFile(src);
  });
  afterAll(() => {
    fs.rmSync(src, { force: true });
    if (thumbRel) fs.rmSync(path.join(MEDIA_ROOT, thumbRel), { force: true });
  });

  it('★ Orientation 6 の写真のサムネイルは、開いたときと同じ縦長になる', async () => {
    thumbRel = await generateThumbnail(src, 'image/jpeg');
    expect(thumbRel).not.toBeNull();
    const meta = await sharp(path.join(MEDIA_ROOT, thumbRel!)).metadata();
    expect(meta.height!).toBeGreaterThan(meta.width!);
    expect(meta.orientation ?? 1).toBe(1);   // 回し終えたので印は残さない (ブラウザが二重に回さない)
  });
});
