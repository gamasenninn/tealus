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
 * Mark messages as read. Updates both room_read_cursors and message_reads.
 */
router.post('/', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { message_ids } = req.body;

  if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
    return res.status(400).json({ error: 'message_idsは必須です' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert message_reads (ignore duplicates)
    for (const msgId of message_ids) {
      await client.query(
        `INSERT INTO message_reads (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [msgId, userId]
      );
    }

    // Update room_read_cursors to the latest message
    // Find the latest message among the ones being marked as read
    const latestMsg = await client.query(
      `SELECT id, created_at FROM messages
       WHERE id = ANY($1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [message_ids]
    );

    if (latestMsg.rows.length > 0) {
      await client.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4)
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

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Mark read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

/**
 * POST /api/rooms/:id/read/all
 * Mark all unread messages in the room as read.
 */
router.post('/all', async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find all unread messages from other users in this room
    const unread = await client.query(
      `SELECT m.id, m.created_at FROM messages m
       WHERE m.room_id = $1
         AND m.sender_id != $2
         AND m.is_deleted = false
         AND NOT EXISTS (
           SELECT 1 FROM message_reads mr
           WHERE mr.message_id = m.id AND mr.user_id = $2
         )
       ORDER BY m.created_at ASC`,
      [roomId, userId]
    );

    const messageIds = unread.rows.map(r => r.id);

    if (messageIds.length > 0) {
      // Bulk insert message_reads in batches (to handle large volumes)
      const BATCH_SIZE = 1000;
      for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
        const batch = messageIds.slice(i, i + BATCH_SIZE);
        const values = batch.map((id, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(', ');
        const params = batch.flatMap(id => [id, userId]);
        await client.query(
          `INSERT INTO message_reads (message_id, user_id)
           VALUES ${values}
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          params
        );
      }

      // Update room_read_cursors to the latest message
      const latest = unread.rows[unread.rows.length - 1];
      await client.query(
        `INSERT INTO room_read_cursors (room_id, user_id, last_read_message_id, last_read_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, user_id)
         DO UPDATE SET
           last_read_message_id = EXCLUDED.last_read_message_id,
           last_read_at = EXCLUDED.last_read_at`,
        [roomId, userId, latest.id, latest.created_at]
      );
    }

    await client.query('COMMIT');

    logger.info(`Mark all read: ${userId} in room ${roomId} (${messageIds.length} messages)`);
    res.json({ success: true, count: messageIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Mark all read error:', err);
    res.status(500).json({ error: E.SERVER_ERROR });
  } finally {
    client.release();
  }
});

module.exports = router;
