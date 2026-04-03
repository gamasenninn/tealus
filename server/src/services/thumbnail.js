const logger = require('../utils/logger');
const sharp = require('sharp');
const path = require('path');
const { MEDIA_ROOT } = require('../middleware/upload');

const THUMBNAIL_WIDTH = 300;

/**
 * Generate a thumbnail for an image file.
 * Returns the thumbnail path relative to MEDIA_ROOT, or null if not an image.
 */
async function generateThumbnail(filePath, mimetype) {
  if (!mimetype.startsWith('image/')) {
    return null;
  }

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
    logger.error('Thumbnail generation error:', err);
    return null;
  }
}

module.exports = { generateThumbnail };
