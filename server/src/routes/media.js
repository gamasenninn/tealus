const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { upload, getMessageType, getSubdir } = require('../middleware/upload');
const { generateThumbnail } = require('../services/thumbnail');

const router = express.Router({ mergeParams: true });

/**
 * POST /api/rooms/:id/media
 * Upload a file and create a media message
 */
router.post('/', authenticate, upload.single('file'), async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  // Check membership
  const memberCheck = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  if (memberCheck.rows.length === 0) {
    return res.status(403).json({ error: 'このルームにアクセスする権限がありません' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'ファイルが添付されていません' });
  }

  const file = req.file;
  const messageType = getMessageType(file.mimetype);
  const subdir = getSubdir(file.mimetype);
  const relativePath = `${subdir}/${file.filename}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create message
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [roomId, userId, messageType]
    );
    const message = msgResult.rows[0];

    // Generate thumbnail for images
    const thumbnailPath = await generateThumbnail(file.path, file.mimetype);

    // Get image dimensions if image
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

    // Create media record
    const mediaResult = await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size, width, height, thumbnail_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [message.id, relativePath, file.originalname, file.mimetype, file.size, width, height, thumbnailPath]
    );

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const { io } = require('../app');
    const fullMessage = {
      ...message,
      sender_display_name: req.user.display_name,
      media: [mediaResult.rows[0]],
    };
    io.to(roomId).emit('message:new', fullMessage);

    res.status(201).json({
      message,
      media: mediaResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Media upload error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

module.exports = router;
