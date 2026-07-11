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

    await sharp(filePath)
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
      execFile('ffmpeg', [
        '-i', filePath,
        '-ss', '00:00:01',
        '-vframes', '1',
        '-vf', `scale=${THUMBNAIL_WIDTH}:-1`,
        '-y',
        thumbnailPath,
      ], (err) => {
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
