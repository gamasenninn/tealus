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
        };

        // Broadcast to room (including sender)
        io.to(room_id).emit('message:new', message);
      } catch (err) {
        console.error('Socket message:send error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.user.display_name} (${socket.id})`);
    });
  });
}

module.exports = { setupSocketHandlers };
