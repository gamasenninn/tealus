const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { JWT_SECRET } = require('../middleware/auth');
const { registerMessageHandler } = require('./handlers/message');
const { registerReadHandler } = require('./handlers/read');
const { registerTypingHandler } = require('./handlers/typing');

// Online users: userId -> Set of socketIds
const onlineUsers = new Map();

function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

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
        'SELECT id, employee_id, display_name, avatar_url, role FROM users WHERE id = $1 AND is_active = true',
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
    logger.info(`Client connected: ${socket.user.display_name} (${socket.id})`);

    const userId = socket.user.id;

    // Join user-specific room (for targeted events like stamp generation)
    socket.join(`user:${userId}`);

    // Admin: join all rooms for dashboard monitoring
    if (socket.user.role === 'admin') {
      pool.query('SELECT id FROM rooms').then(result => {
        for (const r of result.rows) {
          socket.join(r.id);
        }
        logger.info(`Admin ${socket.user.display_name} joined all ${result.rows.length} rooms for monitoring`);
      }).catch(() => {});
    }

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      socket.broadcast.emit('user:online', { user_id: userId });
    }
    onlineUsers.get(userId).add(socket.id);

    // Room join/leave
    socket.on('room:join', async (roomId) => {
      const result = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, socket.user.id]
      );
      if (result.rows.length > 0) {
        socket.join(roomId);
      }
    });

    socket.on('room:leave', (roomId) => {
      socket.leave(roomId);
    });

    // Register handlers
    registerMessageHandler(socket, io);
    registerReadHandler(socket);
    registerTypingHandler(socket);

    // Disconnect
    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.user.display_name} (${socket.id})`);

      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          socket.broadcast.emit('user:offline', { user_id: userId });
        }
      }
    });
  });
}

module.exports = { setupSocketHandlers, getOnlineUserIds };
