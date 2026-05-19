const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../utils/permissions');
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
  const { prompt, name, room_id, labels } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'プロンプトは必須です' });
  }

  // Check daily limit (admin exempt)
  if (!isAdmin(req.user)) {
    const todayCount = await checkDailyLimit(pool, userId);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({ error: `1日の生成上限（${DAILY_LIMIT}パック）に達しました` });
    }
  }

  // Capture values before response (req may be GC'd after response)
  const jobId = require('crypto').randomUUID();
  const packName = name?.trim() || prompt.trim().slice(0, 50);
  const promptText = prompt.trim();
  const displayName = req.user.display_name;
  const roomId = room_id || null;
  const customLabels = Array.isArray(labels) ? labels.filter(l => l && l.trim()) : null;

  // Return immediately with 202 Accepted
  res.status(202).json({ jobId, message: 'スタンプ生成を開始しました' });

  // Run generation in background (fully independent of request lifecycle)
  const { io } = require('../app');
  (async () => {
    try {
      // Generate stamps via AI
      const result = await generateStampPack(promptText, customLabels);

      if (result.stamps.length === 0) {
        io.to(`user:${userId}`).emit('stamp:error', { jobId, error: 'スタンプの生成に失敗しました' });
        return;
      }

      // Create pack in DB
      const packRes = await pool.query(
        `INSERT INTO stamp_packs (name, prompt, created_by)
         VALUES ($1, $2, $3) RETURNING *`,
        [packName, promptText, userId]
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

      logger.info(`Stamp pack created: "${packName}" by ${displayName} (${savedFiles.length} stamps)`);

      // Send system message to the room where stamp was created
      if (roomId) {
        try {
          const systemMsg = `🎉 スタンプパック「${packName}」が完成しました！（${savedFiles.length}枚）`;
          const msgRes = await pool.query(
            `INSERT INTO messages (room_id, sender_id, content, type)
             VALUES ($1, $2, $3, 'system') RETURNING *`,
            [roomId, userId, systemMsg]
          );
          io.to(roomId).emit('message:new', {
            ...msgRes.rows[0],
            sender_display_name: displayName,
          });
        } catch (e) {
          logger.error('Stamp system message error:', e);
        }
      }

      // Notify via Socket.IO (user may have navigated away, but that's OK)
      io.to(`user:${userId}`).emit('stamp:generated', {
        jobId,
        pack,
        stamps: savedFiles,
        count: savedFiles.length,
      });
    } catch (err) {
      logger.error('Stamp generation error:', err);

      // Send error system message to the room
      if (roomId) {
        try {
          const errorMsg = `⚠️ スタンプパック「${packName}」の生成に失敗しました。別のプロンプトで試してみてください。`;
          const msgRes = await pool.query(
            `INSERT INTO messages (room_id, sender_id, content, type)
             VALUES ($1, $2, $3, 'system') RETURNING *`,
            [roomId, userId, errorMsg]
          );
          io.to(roomId).emit('message:new', {
            ...msgRes.rows[0],
            sender_display_name: displayName,
          });
        } catch (e) {
          logger.error('Stamp error message error:', e);
        }
      }

      try {
        io.to(`user:${userId}`).emit('stamp:error', { jobId, error: err.message });
      } catch (e) {
        // Socket may be gone, ignore
      }
    }
  })();
});

/**
 * GET /api/stamps/packs
 * List all stamp packs
 */
router.get('/packs', async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(
      `SELECT sp.*, u.display_name AS creator_name,
              (SELECT COUNT(*)::int FROM stamps WHERE pack_id = sp.id) AS stamp_count,
              usu.last_used_at AS my_last_used_at
       FROM stamp_packs sp
       JOIN users u ON u.id = sp.created_by
       LEFT JOIN user_stamp_usage usu ON usu.pack_id = sp.id AND usu.user_id = $1
       ORDER BY usu.last_used_at DESC NULLS LAST, sp.created_at DESC`,
      [userId]
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

    if (pack.rows[0].created_by !== userId && !isAdmin(req.user)) {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    // Move files to deleted folder
    const packName = (await pool.query('SELECT name FROM stamp_packs WHERE id = $1', [packId])).rows[0]?.name || '';
    const { MEDIA_ROOT } = require('../middleware/upload');
    const path = require('path');
    const fs = require('fs');
    const srcDir = path.join(MEDIA_ROOT, 'stamps', packId);
    if (fs.existsSync(srcDir)) {
      const deletedDir = path.join(MEDIA_ROOT, 'stamps', 'deleted');
      if (!fs.existsSync(deletedDir)) fs.mkdirSync(deletedDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeName = packName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 30);
      const destDir = path.join(deletedDir, `${date}_${safeName}_${packId}`);
      fs.renameSync(srcDir, destDir);
      logger.info(`Stamp pack files moved to: ${destDir}`);
    }

    await pool.query('DELETE FROM stamp_packs WHERE id = $1', [packId]);

    logger.info(`Stamp pack deleted: ${packId} by ${req.user.display_name}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Stamp pack delete error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * PUT /api/stamps/packs/:id
 * Update pack name (creator or admin only)
 */
router.put('/packs/:id', async (req, res) => {
  const packId = req.params.id;
  const userId = req.user.id;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'パック名は必須です' });
  }

  try {
    const pack = await pool.query(
      'SELECT created_by FROM stamp_packs WHERE id = $1',
      [packId]
    );

    if (pack.rows.length === 0) {
      return res.status(404).json({ error: 'スタンプパックが見つかりません' });
    }

    if (pack.rows[0].created_by !== userId && !isAdmin(req.user)) {
      return res.status(403).json({ error: '編集権限がありません' });
    }

    await pool.query(
      'UPDATE stamp_packs SET name = $1 WHERE id = $2',
      [name.trim(), packId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Stamp pack rename error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * DELETE /api/stamps/:id
 * Delete an individual stamp (creator or admin only)
 */
router.delete('/:id', async (req, res) => {
  const stampId = req.params.id;
  const userId = req.user.id;

  try {
    const stamp = await pool.query(
      `SELECT s.id, sp.created_by FROM stamps s
       JOIN stamp_packs sp ON sp.id = s.pack_id
       WHERE s.id = $1`,
      [stampId]
    );

    if (stamp.rows.length === 0) {
      return res.status(404).json({ error: 'スタンプが見つかりません' });
    }

    if (stamp.rows[0].created_by !== userId && !isAdmin(req.user)) {
      return res.status(403).json({ error: '削除権限がありません' });
    }

    await pool.query('DELETE FROM stamps WHERE id = $1', [stampId]);

    logger.info(`Stamp deleted: ${stampId} by ${req.user.display_name}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Stamp delete error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
