const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

const VOICE_DIR = path.join(__dirname, '../../../media/voices');

const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VOICE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const voiceUpload = multer({
  storage: voiceStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

/**
 * POST /api/rooms/:id/voice
 * Upload a voice message
 */
router.post('/', authenticate, (req, res, next) => {
  voiceUpload.single('voice')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'ファイルサイズが上限を超えています' });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
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
    return res.status(400).json({ error: '音声ファイルが添付されていません' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create voice message
    const msgResult = await client.query(
      `INSERT INTO messages (room_id, sender_id, type)
       VALUES ($1, $2, 'voice')
       RETURNING *`,
      [roomId, userId]
    );
    const message = msgResult.rows[0];

    const relativePath = `voices/${req.file.filename}`;

    // Create media record
    const mediaResult = await client.query(
      `INSERT INTO message_media (message_id, file_path, file_name, mime_type, file_size)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [message.id, relativePath, req.file.originalname, req.file.mimetype, req.file.size]
    );

    // Create pending transcription record (for Step B)
    await client.query(
      `INSERT INTO voice_transcriptions (message_id, status)
       VALUES ($1, 'pending')`,
      [message.id]
    );

    await client.query('COMMIT');

    // Broadcast via Socket.IO
    const { io } = require('../app');
    const fullMessage = {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
      media: [mediaResult.rows[0]],
    };
    io.to(roomId).emit('message:new', fullMessage);

    res.status(201).json({
      message,
      media: mediaResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Voice upload error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    client.release();
  }
});

module.exports = router;
