const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');
const { upload, getMessageType, getSubdir } = require('../middleware/upload');
const { generateThumbnail } = require('../services/thumbnail');
const { MAX_UPLOAD_FILES } = require('../constants/config');

const router = express.Router({ mergeParams: true });

/**
 * POST /api/rooms/:id/media
 * Upload one or more files and create a media message
 * Supports: upload.single('file') or upload.array('files', 20)
 */
router.post('/', authenticate, requireMember, (req, res, next) => {
  upload.array('files', MAX_UPLOAD_FILES)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'ファイルサイズが上限を超えています（最大100MB）' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  // Support both single file (field: 'file') and multiple files (field: 'files')
  const files = req.files || (req.file ? [req.file] : []);
  if (files.length === 0) {
    return res.status(400).json({ error: 'ファイルが添付されていません' });
  }

  // Determine message type from first file
  const messageType = getMessageType(files[0].mimetype);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create one message for all files
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roomId, userId, messageType]
    );
    const message = msgResult.rows[0];

    const mediaRecords = [];

    for (const file of files) {
      const subdir = getSubdir(file.mimetype);
      const relativePath = `${subdir}/${file.filename}`;

      // Generate thumbnail for images
      const thumbnailPath = await generateThumbnail(file.path, file.mimetype);

      // Get image dimensions
      let width = null;
      let height = null;
      if (file.mimetype.startsWith('image/')) {
        try {
          const sharp = require('sharp');
          const metadata = await sharp(file.path).metadata();
          width = metadata.width;
          height = metadata.height;
        } catch (e) {
          // Ignore metadata errors
        }
      }

      const mediaResult = await client.query(
        `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [message.id, relativePath, file.originalname, file.mimetype, file.size, width, height, thumbnailPath]
      );
      mediaRecords.push(mediaResult.rows[0]);
    }

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const { io } = require('../app');
    const fullMessage = {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
      media: mediaRecords,
    };
    io.to(roomId).emit('message:new', fullMessage);

    res.status(201).json({
      message,
      media: mediaRecords,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Media upload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * GET /api/rooms/:id/media/gallery
 * Media gallery — list all media in a room with optional tag filter
 */
router.get('/gallery', authenticate, requireMember, async (req, res) => {
  const roomId = req.params.id;
  const { tag, category, offset = 0, limit = 30 } = req.query;
  const limitNum = Math.min(parseInt(limit) || 30, 100);
  const offsetNum = parseInt(offset) || 0;

  // Category to mime_type prefix mapping
  const categoryMap = {
    image: 'image/%',
    video: 'video/%',
    audio: 'audio/%',
  };

  try {
    const conditions = ['m.room_id = $1', 'm.is_deleted = false'];
    const params = [roomId];
    let paramIdx = 2;

    if (tag) {
      conditions.push(`mt.tag_id = $${paramIdx++}`);
      params.push(tag);
    }

    if (category && categoryMap[category]) {
      conditions.push(`mm.mime_type LIKE $${paramIdx++}`);
      params.push(categoryMap[category]);
    }

    const tagJoin = tag ? 'JOIN message_tags mt ON mt.message_id = m.id' : '';
    const whereClause = conditions.join(' AND ');

    const query = `
      SELECT mm.*, m.sender_id, m.created_at AS message_created_at,
             u.display_name AS sender_display_name
      FROM message_media mm
      JOIN messages m ON m.id = mm.message_id
      JOIN users u ON u.id = m.sender_id
      ${tagJoin}
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limitNum + 1, offsetNum);

    const result = await pool.query(query, params);
    const hasMore = result.rows.length > limitNum;
    const media = hasMore ? result.rows.slice(0, limitNum) : result.rows;

    res.json({ media, has_more: hasMore });
  } catch (err) {
    logger.error('Media gallery error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
