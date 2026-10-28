/**
 * 画像のサムネイルは、写真の向きの印 (EXIF の Orientation) に従わない (2026-10-28 小野さん判断 A)
 *
 * ★ 10-27 (改善ループ 19 回目) に「縦写真のサムネイルが横倒し」を直そうとして印に従わせたが、
 *   机の上で平らに構えて撮った書類 (出品票) は、スマホが印を誤って付ける (シャッターの瞬間の傾きで 1 と 6 がばらつく)。
 *   印に従うと、正しい横長の書類が 90 度回って並んだ (10-27 18:08 の 7 枚、10-28 10:17 の 1 枚)。
 * ★ 印を無視すると、人が縦に構えて撮った写真のサムネイルは横倒しになる。それを承知で、書類を正しく並べる方を選んだ
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateThumbnail } from '../../src/services/thumbnail.mts';
import { MEDIA_ROOT } from '../../src/middleware/upload.mts';

describe('画像のサムネイルは写真の向きの印に従わない', () => {
  const src = path.join(MEDIA_ROOT, 'images', `orient-test-${process.pid}.jpg`);
  let thumbRel: string | null = null;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.mkdirSync(path.join(MEDIA_ROOT, 'thumbnails'), { recursive: true });
    // 横長 (40x20) に保存し、「90 度回して見せる」(Orientation 6) の印を付ける = 平らに撮った書類で起きる形
    await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .jpeg().withMetadata({ orientation: 6 }).toFile(src);
  });
  afterAll(() => {
    fs.rmSync(src, { force: true });
    if (thumbRel) fs.rmSync(path.join(MEDIA_ROOT, thumbRel), { force: true });
  });

  it('★ Orientation 6 の印があっても、サムネイルは画像そのままの横長', async () => {
    thumbRel = await generateThumbnail(src, 'image/jpeg');
    expect(thumbRel).not.toBeNull();
    const meta = await sharp(path.join(MEDIA_ROOT, thumbRel!)).metadata();
    expect(meta.width!).toBeGreaterThan(meta.height!);
    expect(meta.orientation ?? 1).toBe(1);   // 印を写さない (ブラウザが回さない)
  });
});
