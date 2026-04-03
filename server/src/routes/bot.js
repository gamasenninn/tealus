const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * POST /api/bot/push
 * Send a message to a room (with Socket.IO broadcast)
 */
router.post('/push', async (req, res) => {
  const { room_id, content, type = 'text' } = req.body;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content は必須です' });
  }

  try {
    // Check membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    // Insert message
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [room_id, userId, content.trim(), type]
    );

    const message = result.rows[0];

    // Socket.IO broadcast (the key difference from regular REST API)
    const { io } = require('../app');
    io.to(room_id).emit('message:new', {
      ...message,
      sender_display_name: req.user.display_name,
      sender_avatar_url: req.user.avatar_url,
    });

    logger.info(`Bot push: ${req.user.display_name} → room ${room_id}`);

    res.status(201).json({ message });
  } catch (err) {
    logger.error('Bot push error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/messages?room_id=xxx&since=timestamp
 * Get messages since a timestamp (for polling)
 */
router.get('/messages', async (req, res) => {
  const { room_id, since } = req.query;
  const userId = req.user.id;

  if (!room_id) {
    return res.status(400).json({ error: 'room_id は必須です' });
  }

  try {
    // Check membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
      [room_id, userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'このルームのメンバーではありません' });
    }

    let query;
    let params;

    if (since) {
      query = `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.created_at > $2 AND m.is_deleted = false
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [room_id, since];
    } else {
      query = `
        SELECT m.*, u.display_name AS sender_display_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1 AND m.is_deleted = false
        ORDER BY m.created_at DESC
        LIMIT 20
      `;
      params = [room_id];
    }

    const result = await pool.query(query, params);
    res.json({ messages: result.rows });
  } catch (err) {
    logger.error('Bot messages error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * GET /api/bot/rooms
 * List rooms the bot belongs to
 */
router.get('/rooms', async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT r.id, r.type, r.name, r.icon_url, r.created_at,
              (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) AS member_count
       FROM rooms r
       JOIN room_members rm ON rm.room_id = r.id
       WHERE rm.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    res.json({ rooms: result.rows });
  } catch (err) {
    logger.error('Bot rooms error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/rooms/:id/join
 * Join a room
 */
router.post('/rooms/:id/join', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  try {
    // Check room exists
    const room = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
    if (room.rows.length === 0) {
      return res.status(404).json({ error: E.ROOM_NOT_FOUND });
    }

    // Join (ignore if already member)
    await pool.query(
      `INSERT INTO room_members (room_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [roomId, userId]
    );

    logger.info(`Bot joined room: ${req.user.display_name} → ${roomId}`);

    res.json({ success: true });
  } catch (err) {
    logger.error('Bot join error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
