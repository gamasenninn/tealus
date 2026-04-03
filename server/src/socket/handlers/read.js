const pool = require('../../db/pool');

/**
 * Handle message:read event
 */
function registerReadHandler(socket) {
  socket.on('message:read', async (data) => {
    const { room_id, message_ids } = data;
    if (!room_id || !message_ids || message_ids.length === 0) return;

    try {
      // Insert message_reads
      for (const msgId of message_ids) {
        await pool.query(
          `INSERT INTO message_reads (message_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (message_id, user_id) DO NOTHING`,
          [msgId, socket.user.id]
        );
      }

      // Update room_read_cursor
      const latestMsg = await pool.query(
        `SELECT id, created_at FROM messages
         WHERE id = ANY($1) ORDER BY created_at DESC LIMIT 1`,
        [message_ids]
      );
      if (latestMsg.rows.length > 0) {
        await pool.query(
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
          [room_id, socket.user.id, latestMsg.rows[0].id, latestMsg.rows[0].created_at]
        );
      }

      // Get actual read counts and broadcast
      const readCounts = await pool.query(
        `SELECT message_id, COUNT(*)::int AS read_count
         FROM message_reads WHERE message_id = ANY($1)
         GROUP BY message_id`,
        [message_ids]
      );
      const counts = {};
      readCounts.rows.forEach(r => { counts[r.message_id] = r.read_count; });

      socket.to(room_id).emit('message:read', {
        room_id,
        read_counts: counts,
      });
    } catch (err) {
      console.error('Socket message:read error:', err);
    }
  });
}

module.exports = { registerReadHandler };
