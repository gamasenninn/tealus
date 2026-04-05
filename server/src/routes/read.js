const logger = require('../utils/logger');
const E = require('../constants/errors');
const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requireMember } = require('../middleware/roomAccess');

const router = express.Router({ mergeParams: true });

router.use(authenticate, requireMember);

/**
 * POST /api/rooms/:id/read
 * Mark messages as read (cursor-based).
 * Accepts message_ids array — advances cursor to the latest among them.
 */
router.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { message_ids } = req.body;

  if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'message_idsは必須です' });
  }

  try {
    const latestMsg = await pool.query(
      `SELECT id, created_at FROM messages
       WHERE id = ANY($1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [message_ids]
    );

    if (latestMsg.rows.length > 0) {
      await pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
         ON CONFLICT (room_id, user_id)
         DO UPDATE SET
           last_read_message_id = CASE
             WHEN room_read_cursors.last_read_at < EXCLUDED.last_read_at
             THEN EXCLUDED.last_read_message_id
             ELSE room_read_cursors.last_read_message_id
           END,
           last_read_at = GREATEST(room_read_cursors.last_read_at, EXCLUDED.last_read_at)`,
        [roomId, userId, latestMsg.rows[0].id, latestMsg.rows[0].created_at]
      );
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Mark read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

/**
 * POST /api/rooms/:id/read/all
 * Mark all messages in the room as read.
 */
router.post('/all', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  try {
    // Count current unread
    const unreadRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM messages m
       WHERE m.room_id = $1
         AND m.sender_id != $2
         AND m.is_deleted = false
         AND m.created_at > COALESCE(
           (SELECT last_read_at FROM room_read_cursors WHERE room_id = $1 AND user_id = $2),
           '1970-01-01'
         )`,
      [roomId, userId]
    );

    // Advance cursor to the latest message
    const latest = await pool.query(
      `SELECT id, created_at FROM messages
       WHERE room_id = $1 AND is_deleted = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [roomId]
    );

    if (latest.rows.length > 0) {
      await pool.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4::timestamptz + interval '1 millisecond')
         ON CONFLICT (room_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           last_read_at = EXCLUDED.last_read_at`,
        [roomId, userId, latest.rows[0].id, latest.rows[0].created_at]
      );
    }

    const count = unreadRes.rows[0].count;
    logger.info(`Mark all read: ${userId} in room ${roomId} (${count} messages)`);
    res.json({ success: true, count });
  } catch (err) {
    logger.error('Mark all read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  }
});

module.exports = router;
