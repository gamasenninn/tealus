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

  // Save grid image for future algorithm improvement
  const gridPath = path.join(STAMP_DIR, `grid_${Date.now()}.png`);
  fs.writeFileSync(gridPath, gridBuffer);
  logger.info(`Stamp generation: grid saved to ${gridPath}`);

  // Step 3: Split into individual stamps
  const stamps = await splitGridImage(gridBuffer);
  logger.info(`Stamp generation: split into ${stamps.length} stamps`);

  return { gridBuffer, detailedPrompt, stamps };
}

/**
 * Split a grid image into individual stamp images by detecting grid lines
 */
async function splitGridImage(gridBuffer) {
  const { data, info } = await sharp(gridBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Calculate row variance (low variance = uniform color = grid line)
  const rowVariance = [];
  for (let y = 0; y < height; y++) {
    const values = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      values.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    rowVariance.push(values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length);
  }

  // Calculate column variance
  const colVariance = [];
  for (let x = 0; x < width; x++) {
    const values = [];
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * channels;
      values.push((data[idx] + data[idx + 1] + data[idx + 2]) / 3);
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    colVariance.push(values.reduce((a, v) => a + (v - avg) ** 2, 0) / values.length);
  }

  // Find cell boundaries from low-variance bands (auto-detect grid size)
  const rowBounds = detectCellBounds(rowVariance, height);
  const colBounds = detectCellBounds(colVariance, width);
  const detectedCols = colBounds.length;

  logger.info(`Grid detection: ${rowBounds.length} rows × ${colBounds.length} cols = ${rowBounds.length * colBounds.length} cells`);
  logger.info(`Grid rows: ${JSON.stringify(rowBounds)}`);
  logger.info(`Grid cols: ${JSON.stringify(colBounds)}`);

  const INSET = 2;
  const stamps = [];

  for (let row = 0; row < rowBounds.length; row++) {
    for (let col = 0; col < colBounds.length; col++) {
      const index = row * detectedCols + col;
      const left = colBounds[col].start + INSET;
      const top = rowBounds[row].start + INSET;
      const cellW = colBounds[col].end - colBounds[col].start - INSET * 2;
      const cellH = rowBounds[row].end - rowBounds[row].start - INSET * 2;

      if (cellW <= 0 || cellH <= 0) continue;

      try {
        const extracted = await sharp(gridBuffer)
          .extract({ left, top, width: cellW, height: cellH })
          .resize(STAMP_WIDTH, STAMP_HEIGHT, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 0 },
          })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Remove white/near-white background
        const pixels = extracted.data;
        const threshold = 240;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] >= threshold && pixels[i + 1] >= threshold && pixels[i + 2] >= threshold) {
            pixels[i + 3] = 0;
          }
        }

        const buffer = await sharp(pixels, {
          raw: { width: extracted.info.width, height: extracted.info.height, channels: 4 },
        }).png().toBuffer();

        stamps.push({
          buffer,
          label: STAMP_LABELS[index] || `stamp_${index + 1}`,
          index,
        });
      } catch (err) {
        logger.error(`Stamp split error at [${row},${col}]:`, err);
      }
    }
  }

  return stamps;
}

/**
 * Find bright bands (grid lines + margins) in brightness array,
 * then return the dark regions between them as cell bounds.
 */
/**
 * Detect cell bounds using variance-based grid line detection.
 * Auto-detects the number of cells (no fixed grid size assumption).
 */
function detectCellBounds(variance, totalSize) {
  const VARIANCE_THRESHOLD = 100;
  const GAP_TOLERANCE = 15;
  const MIN_BAND_WIDTH = 10;
  const MIN_CELL_SIZE = 50;

  // Find low-variance runs (grid lines / margins)
  const rawBands = [];
  let runStart = -1;
  for (let i = 0; i < variance.length; i++) {
    if (variance[i] < VARIANCE_THRESHOLD) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        rawBands.push({ start: runStart, end: i });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) rawBands.push({ start: runStart, end: variance.length });

  if (rawBands.length === 0) {
    logger.warn('Grid detection: no low-variance bands found');
    return [{ start: 0, end: totalSize }];
  }

  // Merge close bands and filter narrow ones
  const merged = [{ ...rawBands[0] }];
  for (let i = 1; i < rawBands.length; i++) {
    const prev = merged[merged.length - 1];
    if (rawBands[i].start - prev.end < GAP_TOLERANCE) {
      prev.end = rawBands[i].end;
    } else {
      merged.push({ ...rawBands[i] });
    }
  }
  const bands = merged.filter(b => (b.end - b.start) >= MIN_BAND_WIDTH);

  // Build cells from gaps between bands
  const cells = [];
  for (let i = 0; i < bands.length - 1; i++) {
    cells.push({ start: bands[i].end, end: bands[i + 1].start });
  }
  // If last band doesn't reach the edge, add a cell after it
  if (bands.length > 0 && bands[bands.length - 1].end < totalSize - MIN_BAND_WIDTH) {
    cells.push({ start: bands[bands.length - 1].end, end: totalSize });
  }
  // If first band doesn't start at edge, add a cell before it
  if (bands.length > 0 && bands[0].start > MIN_BAND_WIDTH) {
    cells.unshift({ start: 0, end: bands[0].start });
  }

  // Filter out cells that are too small
  const validCells = cells.filter(c => (c.end - c.start) >= MIN_CELL_SIZE);

  logger.info(`Grid detection: ${bands.length} bands → ${validCells.length} cells`);
  return validCells;
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
