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
 * GET /api/bot/unread?room_id=optional
 * Get unread messages across all rooms or a specific room
 */
router.get('/unread', async (req, res) => {
  const { room_id } = req.query;
  const userId = req.user.id;

  try {
    let query;
    let params;

    if (room_id) {
      // Specific room
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        WHERE m.room_id = $1
          AND m.sender_id != $2
          AND m.is_deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $2
          )
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [room_id, userId];
    } else {
      // All rooms
      query = `
        SELECT m.id, m.room_id, m.sender_id, m.content, m.type, m.created_at,
               u.display_name AS sender_display_name,
               r.name AS room_name, r.type AS room_type
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN rooms r ON r.id = m.room_id
        JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = $1
        WHERE m.sender_id != $1
          AND m.is_deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $1
          )
        ORDER BY m.created_at ASC
        LIMIT 100
      `;
      params = [userId];
    }

    const result = await pool.query(query, params);

    // For voice messages, get transcription
    for (const msg of result.rows) {
      if (msg.type === 'voice') {
        const trans = await pool.query(
          `SELECT formatted_text, raw_text FROM voice_transcriptions
           WHERE message_id = $1 ORDER BY version DESC LIMIT 1`,
          [msg.id]
        );
        if (trans.rows.length > 0) {
          msg.content = trans.rows[0].formatted_text || trans.rows[0].raw_text || msg.content;
        }
      }
    }

    res.json({ messages: result.rows });
  } catch (err) {
    logger.error('Bot unread error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/bot/mark-read
 * Mark messages as read
 */
router.post('/mark-read', async (req, res) => {
  const { message_ids } = req.body;
  const userId = req.user.id;

  if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'message_ids は必須です' });
  }

  try {
    for (const msgId of message_ids) {
      await pool.query(
        `INSERT INTO message_reads (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [msgId, userId]
      );
    }

    logger.info(`Bot mark-read: ${message_ids.length} messages`);
    res.json({ success: true, count: message_ids.length });
  } catch (err) {
    logger.error('Bot mark-read error:', err);
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
