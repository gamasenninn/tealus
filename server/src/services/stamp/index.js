const logger = require('../../utils/logger');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { createTextProvider, STAMP_LABELS } = require('./textProviders');
const { createImageProvider } = require('./imageProviders');
const { MEDIA_ROOT } = require('../../middleware/upload');

const STAMP_DIR = path.join(MEDIA_ROOT, 'stamps');
const GRID_COLS = 4;
const GRID_ROWS = 4;
const STAMP_WIDTH = 370;
const STAMP_HEIGHT = 320;

// Ensure stamps directory exists
if (!fs.existsSync(STAMP_DIR)) {
  fs.mkdirSync(STAMP_DIR, { recursive: true });
}

/**
 * Generate a stamp pack from user prompt
 * @param {string} userPrompt - User's stamp description
 * @returns {object} { gridImageBuffer, stamps: [{ buffer, label, index }] }
 */
async function generateStampPack(userPrompt) {
  // Step 1: Convert user prompt to detailed image prompt
  logger.info(`Stamp generation: converting prompt "${userPrompt}"`);
  const textProvider = createTextProvider(process.env.STAMP_TEXT_PROVIDER);
  const detailedPrompt = await textProvider.generateStampPrompt(userPrompt);
  logger.info(`Stamp generation: detailed prompt ready (${detailedPrompt.length} chars)`);

  // Step 2: Generate grid image
  logger.info('Stamp generation: generating grid image...');
  const imageProvider = createImageProvider(process.env.STAMP_IMAGE_PROVIDER);
  const gridBuffer = await imageProvider.generate(detailedPrompt);
  logger.info(`Stamp generation: grid image received (${gridBuffer.length} bytes)`);

  // Step 3: Split into individual stamps
  const stamps = await splitGridImage(gridBuffer);
  logger.info(`Stamp generation: split into ${stamps.length} stamps`);

  return { gridBuffer, detailedPrompt, stamps };
}

/**
 * Split a grid image into individual stamp images
 */
async function splitGridImage(gridBuffer) {
  const metadata = await sharp(gridBuffer).metadata();
  const cellWidth = Math.floor(metadata.width / GRID_COLS);
  const cellHeight = Math.floor(metadata.height / GRID_ROWS);

  const stamps = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const index = row * GRID_COLS + col;
      try {
        const buffer = await sharp(gridBuffer)
          .extract({
            left: col * cellWidth,
            top: row * cellHeight,
            width: cellWidth,
            height: cellHeight,
          })
          .resize(STAMP_WIDTH, STAMP_HEIGHT)
          .png()
          .toBuffer();

        stamps.push({
          buffer,
          label: STAMP_LABELS[index] || `stamp_${index + 1}`,
          index,
        });
      } catch (err) {
        logger.error(`Stamp split error at [${row},${col}]:`, err);
        // Continue with remaining stamps (partial success)
      }
    }
  }

  return stamps;
}

/**
 * Save stamp files to disk
 * @param {string} packId - Stamp pack UUID
 * @param {Array} stamps - Array of { buffer, label, index }
 * @returns {Array} Array of { filePath, label, index }
 */
async function saveStampFiles(packId, stamps) {
  const packDir = path.join(STAMP_DIR, packId);
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir, { recursive: true });
  }

  const saved = [];
  for (const stamp of stamps) {
    const safeLabel = stamp.label.replace(/[<>:"/\\|?!*]/g, '_');
    const fileName = `${String(stamp.index).padStart(2, '0')}_${safeLabel}.png`;
    const filePath = path.join(packDir, fileName);
    fs.writeFileSync(filePath, stamp.buffer);

    saved.push({
      filePath: `stamps/${packId}/${fileName}`,
      label: stamp.label,
      index: stamp.index,
    });
  }

  return saved;
}

/**
 * Check daily generation limit
 */
async function checkDailyLimit(pool, userId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM stamp_packs
     WHERE created_by = $1 AND created_at > NOW() - INTERVAL '1 day'`,
    [userId]
  );
  return result.rows[0].count;
}

module.exports = { generateStampPack, saveStampFiles, checkDailyLimit, STAMP_LABELS };
