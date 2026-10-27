/**
 * スマホの縦写真のサムネイルが横倒しになっていた (改善ループ 19 回目)
 * ★ sharp は既定で写真の向き (EXIF の Orientation) に従わず、出力から EXIF も落とす。
 *   元の写真はブラウザが向きを見て起こすが、サムネイルはカメラが保存した向きのまま出ていた (本番の新しい JPEG 300 枚中 43 枚)
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateThumbnail } from '../../src/services/thumbnail.mts';
import { MEDIA_ROOT } from '../../src/middleware/upload.mts';

describe('画像のサムネイルは写真の向きに従う', () => {
  const src = path.join(MEDIA_ROOT, 'images', `orient-test-${process.pid}.jpg`);
  let thumbRel: string | null = null;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.mkdirSync(path.join(MEDIA_ROOT, 'thumbnails'), { recursive: true });
    // 横長 (40x20) に保存し、「90 度回して見せる」(Orientation 6) の印を付ける = 見た目は縦長
    await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .jpeg().withMetadata({ orientation: 6 }).toFile(src);
  });
  afterAll(() => {
    fs.rmSync(src, { force: true });
    if (thumbRel) fs.rmSync(path.join(MEDIA_ROOT, thumbRel), { force: true });
  });

  it('★ Orientation 6 の写真のサムネイルは縦長になる', async () => {
    thumbRel = await generateThumbnail(src, 'image/jpeg');
    expect(thumbRel).not.toBeNull();
    const meta = await sharp(path.join(MEDIA_ROOT, thumbRel!)).metadata();
    expect(meta.height!).toBeGreaterThan(meta.width!);
  });
});
