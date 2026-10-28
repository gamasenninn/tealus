import { logger } from '../utils/logger.mts';
import sharp from 'sharp';
import path from 'node:path';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { MEDIA_ROOT } from '../middleware/upload.mts';

const THUMBNAIL_WIDTH = 300;

/**
 * Generate a thumbnail for an image or video file.
 * Returns the thumbnail path relative to MEDIA_ROOT, or null if unsupported.
 */
export async function generateThumbnail(filePath: string, mimetype: string): Promise<string | null> {
  if (mimetype.startsWith('image/')) {
    return generateImageThumbnail(filePath);
  }
  if (mimetype.startsWith('video/')) {
    return generateVideoThumbnail(filePath);
  }
  return null;
}

async function generateImageThumbnail(filePath: string): Promise<string | null> {
  try {
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const thumbnailFilename = `${basename}_thumb${ext}`;
    const thumbnailPath = path.join(MEDIA_ROOT, 'thumbnails', thumbnailFilename);

    // ★ .rotate() (引数なし) で写真の向きの印 (EXIF の Orientation) に従う (2026-10-28 小野さん判断 B)。
    //   開いて大きく見たときはブラウザが印に従うので、サムネイルも同じ向きにする (撮り方を誤ればその場で見えて撮り直せる)。
    //   ★ 机の上で平らに撮った書類はスマホが印を誤って付ける (真下に向けると 1 と 6 がばらつく)。一度「印を無視」に戻したが
    //   (10-28 午前 A)、サムネイルは正しいのに開くと回る食い違いで誤りが隠れたので、撮り方は人が気をつける形にした
    await sharp(filePath)
      .rotate()
      .resize(THUMBNAIL_WIDTH)
      .toFile(thumbnailPath);

    return `thumbnails/${thumbnailFilename}`;
  } catch (err) {
    logger.error('Image thumbnail error:', err);
    return null;
  }
}

async function generateVideoThumbnail(filePath: string): Promise<string | null> {
  try {
    const basename = path.basename(filePath, path.extname(filePath));
    const thumbnailFilename = `${basename}_thumb.jpg`;
    const thumbnailPath = path.join(MEDIA_ROOT, 'thumbnails', thumbnailFilename);

    await new Promise<void>((resolve, reject) => {
      // ★ 時間切れ 60 秒 (改善ループ 13 回目)。添付の投稿は DB の接続を握ったままここを待つので、固まった ffmpeg で詰まらせない
      execFile('ffmpeg', [
        '-i', filePath,
        '-ss', '00:00:01',
        '-vframes', '1',
        '-vf', `scale=${THUMBNAIL_WIDTH}:-1`,
        '-y',
        thumbnailPath,
      ], { timeout: 60_000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (fs.existsSync(thumbnailPath)) {
      return `thumbnails/${thumbnailFilename}`;
    }
    return null;
  } catch (err) {
    logger.error('Video thumbnail error:', err);
    return null;
  }
}
