const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { JWT_SECRET } = require('../middleware/auth');

/**
 * Set up Socket.IO handlers with JWT authentication
 */
function setupSocketHandlers(io) {
  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('認証トークンがありません'));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const result = await pool.query(
        'SELECT id, employee_id, display_name FROM users WHERE id = $1 AND is_active = true',
        [decoded.id]
      );
      if (result.rows.length === 0) {
        return next(new Error('ユーザーが見つかりません'));
      }
      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error('トークンが無効です'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.user.display_name} (${socket.id})`);

    // Join a room
    socket.on('room:join', async (roomId) => {
      // Verify membership before allowing join
      const result = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, socket.user.id]
      );
      if (result.rows.length > 0) {
        socket.join(roomId);
      }
    });

    // Leave a room
    socket.on('room:leave', (roomId) => {
      socket.leave(roomId);
    });

    // Send a message
    socket.on('message:send', async (data) => {
      const { room_id, content, type = 'text', reply_to } = data;

      if (!room_id || !content || content.trim() === '') return;

      // Verify membership
      const memberCheck = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [room_id, socket.user.id]
      );
      if (memberCheck.rows.length === 0) return;

      try {
        // Save to DB
        const result = await pool.query(
          `INSERT INTO messages (room_id, sender_id, content, type, reply_to)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [room_id, socket.user.id, content.trim(), type, reply_to || null]
        );

        const message = {
          ...result.rows[0],
          sender_display_name: socket.user.display_name,
          sender_avatar_url: socket.user.avatar_url,
          reply_to_message: null,
        };

        // Attach reply_to message info if exists
        if (reply_to) {
          const replyResult = await pool.query(
            `SELECT m.id, m.content, m.type, m.sender_id, u.display_name AS sender_display_name,
                    vt.formatted_text AS transcription_text, vt.raw_text AS transcription_raw
             FROM messages m JOIN users u ON u.id = m.sender_id
             LEFT JOIN LATERAL (
               SELECT formatted_text, raw_text FROM voice_transcriptions
               WHERE message_id = m.id ORDER BY version DESC LIMIT 1
             ) vt ON m.type = 'voice'
             WHERE m.id = $1`,
            [reply_to]
          );
          if (replyResult.rows.length > 0) {
            const r = replyResult.rows[0];
            if (r.type === 'voice' && !r.content) {
              r.content = r.transcription_text || r.transcription_raw || null;
            }
            message.reply_to_message = r;
          }
        }

        // Broadcast to room (including sender)
        io.to(room_id).emit('message:new', message);
      } catch (err) {
        console.error('Socket message:send error:', err);
      }
    });

    // Mark messages as read + broadcast read event
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

    // Typing indicator — just relay, no DB
    socket.on('typing:start', (room_id) => {
      socket.to(room_id).emit('typing:start', {
        room_id,
        user_id: socket.user.id,
        display_name: socket.user.display_name,
      });
    });

    socket.on('typing:stop', (room_id) => {
      socket.to(room_id).emit('typing:stop', {
        room_id,
        user_id: socket.user.id,
      });
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.user.display_name} (${socket.id})`);
    });
  });
}

module.exports = { setupSocketHandlers };
