const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { generateStampPack, saveStampFiles, checkDailyLimit } = require('../services/stamp');

const router = express.Router();
router.use(authenticate);

const DAILY_LIMIT = 3;

/**
 * POST /api/stamps/generate
 * Generate a stamp pack from user prompt
 */
router.post('/generate', async (req, res) => {
  const userId = req.user.id;
  const { prompt, name } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'プロンプトは必須です' });
  }

  // Check daily limit (admin exempt)
  if (req.user.role !== 'admin') {
    const todayCount = await checkDailyLimit(pool, userId);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: `1日の生成上限（${DAILY_LIMIT}パック）に達しました` });
    }
  }

  try {
    // Generate stamps via AI
    const result = await generateStampPack(prompt.trim());

    if (result.stamps.length === 0) {
      return res.status(500).json({ error: 'スタンプの生成に失敗しました' });
    }

    // Create pack in DB
    const packName = name?.trim() || prompt.trim().slice(0, 50);
    const packRes = await pool.query(
      `INSERT INTO stamp_packs (name, prompt, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [packName, prompt.trim(), userId]
    );
    const pack = packRes.rows[0];

    // Save files to disk
    const savedFiles = await saveStampFiles(pack.id, result.stamps);

    // Insert stamps into DB
    for (const file of savedFiles) {
      await pool.query(
        `INSERT INTO stamps (pack_id, file_path, label, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [pack.id, file.filePath, file.label, file.index]
      );
    }

    // Update thumbnail
    if (savedFiles.length > 0) {
      await pool.query(
        'UPDATE stamp_packs SET thumbnail_path = $1 WHERE id = $2',
        [savedFiles[0].filePath, pack.id]
      );
      pack.thumbnail_path = savedFiles[0].filePath;
    }

    logger.info(`Stamp pack created: "${packName}" by ${req.user.display_name} (${savedFiles.length} stamps)`);

    res.status(201).json({
      pack,
      stamps: savedFiles,
      count: savedFiles.length,
    });
  } catch (err) {
    logger.error('Stamp generation error:', err);
    res.status(500).json({ error: 'スタンプ生成中にエラーが発生しました: ' + err.message });
  }
});

/**
 * GET /api/stamps/packs
 * List all stamp packs
 */
router.get('/packs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sp.*, u.display_name AS creator_name,
              (SELECT COUNT(*)::int FROM stamps WHERE pack_id = sp.id) AS stamp_count
       FROM stamp_packs sp
       JOIN users u ON u.id = sp.created_by
       ORDER BY sp.created_at DESC`
    );
    res.json({ packs: result.rows });
  } catch (err) {
    logger.error('Stamp packs list error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/stamps/packs/:id
 * Get stamps in a pack
 */
router.get('/packs/:id', async (req, res) => {
  const packId = req.params.id;

  try {
    const packRes = await pool.query(
      `SELECT sp.*, u.display_name AS creator_name
       FROM stamp_packs sp
       JOIN users u ON u.id = sp.created_by
       WHERE sp.id = $1`,
      [packId]
    );

    if (packRes.rows.length === 0) {
      return res.status(404).json({ error: 'スタンプパックが見つかりません' });
    }

    const stampsRes = await pool.query(
      'SELECT * FROM stamps WHERE pack_id = $1 ORDER BY sort_order',
      [packId]
    );

    res.json({
      pack: packRes.rows[0],
      stamps: stampsRes.rows,
    });
  } catch (err) {
    logger.error('Stamp pack detail error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/stamps/packs/:id
 * Delete a stamp pack (creator or admin only)
 */
router.delete('/packs/:id', async (req, res) => {
  const packId = req.params.id;
  const userId = req.user.id;

  try {
    const pack = await pool.query(
      'SELECT created_by FROM stamp_packs WHERE id = $1',
      [packId]
    );

    if (pack.rows.length === 0) {
      return res.status(404).json({ error: 'スタンプパックが見つかりません' });
    }

    if (pack.rows[0].created_by !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    await pool.query('DELETE FROM stamp_packs WHERE id = $1', [packId]);

    logger.info(`Stamp pack deleted: ${packId} by ${req.user.display_name}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Stamp pack delete error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
