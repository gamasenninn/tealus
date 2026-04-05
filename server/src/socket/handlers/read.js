const logger = require('../../utils/logger');
const pool = require('../../db/pool');

/**
 * Handle message:read event (cursor-based)
 */
function registerReadHandler(socket) {
  socket.on('message:read', async (data) => {
    const { room_id, message_ids } = data;
    if (!room_id || !message_ids || message_ids.length === 0) return;

    try {
      // Find the latest message among the ones being read
      const latestMsg = await pool.query(
        `SELECT id, created_at FROM messages
         WHERE id = ANY($1) ORDER BY created_at DESC LIMIT 1`,
        [message_ids]
      );

      if (latestMsg.rows.length > 0) {
        // Advance cursor
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
          [room_id, socket.user.id, latestMsg.rows[0].id, latestMsg.rows[0].created_at]
        );
      }

      // Calculate read counts for the affected messages using cursor
      const readCounts = await pool.query(
        `SELECT m.id AS message_id,
                (SELECT COUNT(*)::int FROM room_read_cursors rrc
                 WHERE rrc.room_id = $2 AND rrc.last_read_at >= m.created_at AND rrc.user_id != m.sender_id
                ) AS read_count
         FROM messages m
         WHERE m.id = ANY($1)`,
        [message_ids, room_id]
      );
      const counts = {};
      readCounts.rows.forEach(r => { counts[r.message_id] = r.read_count; });

      socket.to(room_id).emit('message:read', {
        room_id,
        read_counts: counts,
      });
    } catch (err) {
      logger.error('Socket message:read error:', err);
    }
  });
}

module.exports = { registerReadHandler };
