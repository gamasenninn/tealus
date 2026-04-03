const E = require('../constants/errors');
const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');
const { upload, getMessageType, getSubdir } = require('../middleware/upload');
const { generateThumbnail } = require('../services/thumbnail');

const router = express.Router({ mergeParams: true });

/**
 * POST /api/rooms/:id/media
 * Upload one or more files and create a media message
 * Supports: upload.single('file') or upload.array('files', 20)
 */
router.post('/', authenticate, requireMember, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
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
    console.error('Media upload error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

module.exports = router;
