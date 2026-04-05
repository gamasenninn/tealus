const logger = require('./utils/logger');
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const mediaRoutes = require('./routes/media');
const readRoutes = require('./routes/read');
const pushRoutes = require('./routes/push');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const voiceRoutes = require('./routes/voice');
const memberRoutes = require('./routes/members');
const transcriptionRoutes = require('./routes/transcription');
const searchRoutes = require('./routes/search');
const botRoutes = require('./routes/bot');
const { roomRouter: tagRoomRoutes, messageRouter: tagMessageRoutes } = require('./routes/tags');
const stampRoutes = require('./routes/stamps');
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms/:id/messages', messageRoutes);
app.use('/api/rooms/:id/media', mediaRoutes);
app.use('/api/rooms/:id/read', readRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rooms/:id/voice', voiceRoutes);
app.use('/api/rooms/:id/members', memberRoutes);
app.use('/api/messages/:id/transcription', transcriptionRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/rooms/:id/tags', tagRoomRoutes);
app.use('/api/messages/:id/tags', tagMessageRoutes);
app.use('/api/stamps', stampRoutes);

// Static media files
app.use('/media', express.static(path.join(__dirname, '../../media')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve built React app (production)
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));
// SPA fallback — all non-API routes return index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Socket.IO handlers (set up in tests or on direct run)
const { setupSocketHandlers } = require('./socket');
setupSocketHandlers(io);

// Start server (only when run directly, not in tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    logger.info(`Linny server running on port ${PORT}`);
  });
}

module.exports = { app, server, io };
