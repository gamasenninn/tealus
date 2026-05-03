const logger = require('./utils/logger');
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { ensureMediaDirs } = require('./utils/mediaSetup');
const { MEDIA_ROOT } = require('./middleware/upload');
ensureMediaDirs(MEDIA_ROOT);
logger.info(`Media dirs ensured at ${MEDIA_ROOT}`);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());

// Agent Server proxy（express.json() より前に配置 — body をパースせずに転送するため）
const { createProxyMiddleware } = require('http-proxy-middleware');
app.use('/agent-api', createProxyMiddleware({
  target: `http://localhost:${process.env.AGENT_PORT || 4000}`,
  pathRewrite: { '^/agent-api': '' },
  changeOrigin: true,
}));

app.use(express.json());

// API リクエストログ
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.originalUrl.startsWith('/api/')) {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

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
const { roomRouter: tagRoomRoutes, messageRouter: tagMessageRoutes, globalRouter: tagGlobalRoutes } = require('./routes/tags');
const stampRoutes = require('./routes/stamps');
const configRoutes = require('./routes/config');
app.use('/api/config', configRoutes);
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
app.use('/api/tags', tagGlobalRoutes);
app.use('/api/stamps', stampRoutes);

// Static media files
app.use('/media', express.static(process.env.MEDIA_ROOT || path.join(__dirname, '../../media')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// RTC Server proxy（mediasoup 実験サーバーに転送）
const rtcProxy = createProxyMiddleware({
  target: `http://localhost:${process.env.RTC_PORT || 3100}`,
  pathRewrite: { '^/rtc': '' },
  changeOrigin: true,
});
app.use('/rtc', rtcProxy);

// Dashboard static files（/system パス、client SPA fallback より前に配置）
const dashboardDistPath = path.join(__dirname, '../../dashboard/dist');
app.use('/system', express.static(dashboardDistPath));
app.get('/system/*', (req, res) => {
  res.sendFile(path.join(dashboardDistPath, 'index.html'));
});

// Serve built React app (production)
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));
// SPA fallback — all non-API routes return index.html
const clientIndexPath = path.join(clientDistPath, 'index.html');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/socket.io/') || req.path.startsWith('/system/') || req.path.startsWith('/agent-api/') || req.path.startsWith('/rtc/')) {
    return next();
  }
  // Dev mode では client 未ビルドなので分かりやすいメッセージを返す（通常は Vite dev server 経由でアクセス）
  if (!require('fs').existsSync(clientIndexPath)) {
    return res.status(503).type('html').send(
      '<html><body style="font-family:sans-serif;padding:2em;max-width:640px">'
      + '<h1>Tealus server is running, but the client is not built</h1>'
      + '<p>Access the Vite dev server for development: <a href="http://localhost:5173">http://localhost:5173</a></p>'
      + '<p>For production, build the client first: <code>cd client &amp;&amp; npm run build</code></p>'
      + '</body></html>'
    );
  }
  res.sendFile(clientIndexPath);
});

// Socket.IO handlers (set up in tests or on direct run)
const { setupSocketHandlers } = require('./socket');
setupSocketHandlers(io);

// RTC WebSocket upgrade（/rtc/ws パスのみ、Socket.IO と競合しない）
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/rtc/')) {
    rtcProxy.upgrade(req, socket, head);
  }
});

// Start server (only when run directly, not in tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    logger.info(`Tealus server running on port ${PORT}`);
    // rtc-server reachability の動的検出を開始
    const capabilityWatcher = require('./services/capabilityWatcher');
    capabilityWatcher.start(io);
  });
}

module.exports = { app, server, io };
