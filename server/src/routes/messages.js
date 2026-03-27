const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// All routes require authentication
router.use(authenticate);

/**
 * Middleware: check room membership
 */
async function checkMembership(req, res, next) {
  const roomId = req.params.id;
  const userId = req.user.id;

  const result = await pool.query(
    'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'このルームにアクセスする権限がありません' });
  }
  next();
}

router.use(checkMembership);

/**
 * POST /api/rooms/:id/messages
 * Send a message to a room
 */
router.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { content, type = 'text', reply_to } = req.body;

  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'メッセージ内容は必須です' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [roomId, userId, content.trim(), type, reply_to || null]
    );

    const message = result.rows[0];
    res.status(201).json({ message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * GET /api/rooms/:id/messages
 * Get message history with cursor-based pagination
 */
router.get('/', async (req, res) => {
  const roomId = req.params.id;
  const { before, limit = 20 } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  try {
    let query;
    let params;

    if (before) {
      // Get the created_at of the cursor message
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1
          AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)
        ORDER BY m.created_at DESC
        LIMIT $3
      `;
      params = [roomId, before, parsedLimit];
    } else {
      query = `
        SELECT m.*, u.display_name AS sender_display_name, u.avatar_url AS sender_avatar_url
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [roomId, parsedLimit];
    }

    const result = await pool.query(query, params);
    const messages = result.rows;

    // Attach media info to messages that have media
    if (messages.length > 0) {
      const messageIds = messages.map(m => m.id);
      const mediaResult = await pool.query(
        `SELECT * FROM message_media WHERE message_id = ANY($1)`,
        [messageIds]
      );
      const mediaByMessage = {};
      for (const media of mediaResult.rows) {
        if (!mediaByMessage[media.message_id]) {
          mediaByMessage[media.message_id] = [];
        }
        mediaByMessage[media.message_id].push(media);
      }
      for (const msg of messages) {
        msg.media = mediaByMessage[msg.id] || [];
      }
    }

    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

module.exports = router;
