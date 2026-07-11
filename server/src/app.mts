// .env を他 module の評価より先に確定させる (ESM は static import が先に全評価されるため、
// dotenv.config() の呼び出し位置では pool / JWT_SECRET 等に間に合わない — env.mts 参照)
import './env.mts';

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { logger } from './utils/logger.mts';
import { ensureMediaDirs } from './utils/mediaSetup.mts';
import { MEDIA_ROOT } from './middleware/upload.mts';
import { runStartupEnvCheck } from './utils/envCheck.mts';
import { setupSocketHandlers } from './socket/index.mts';
import { setIo } from './io-registry.mts';

import { router as lineRoutes } from './routes/line.mts';
import { router as authRoutes } from './routes/auth.mts';
import { router as roomRoutes } from './routes/rooms.mts';
import { router as messageRoutes } from './routes/messages.mts';
import { router as mediaRoutes } from './routes/media.mts';
import { router as readRoutes } from './routes/read.mts';
import { router as pushRoutes } from './routes/push.mts';
import { router as userRoutes } from './routes/users.mts';
import { router as adminRoutes } from './routes/admin/index.mts';
import { router as voiceRoutes } from './routes/voice.mts';
import { router as memberRoutes } from './routes/members.mts';
import { router as transcriptionRoutes } from './routes/transcription.mts';
import { router as searchRoutes } from './routes/search.mts';
import { router as botRoutes } from './routes/bot.mts';
import { roomRouter as tagRoomRoutes, messageRouter as tagMessageRoutes, globalRouter as tagGlobalRoutes } from './routes/tags.mts';
import { router as stampRoutes } from './routes/stamps.mts';
import { router as configRoutes } from './routes/config.mts';

// 6/9 DoS crash fix: defense in depth global safety net
// (= 個別 async handler の try/catch 漏れに対する Node.js default exit 抑止、
//   socket/index.mts の room:join での Postgres 22P02 unhandledRejection で process kill した
//   事件に対する 2 層目の防御。root cause は個別 handler 側で fix 済)
process.on('unhandledRejection', (reason) => {
  const msg = (reason instanceof Error && reason.message) ? reason.message : String(reason);
  logger.error(`[unhandledRejection] ${msg}`);
  if (reason instanceof Error && reason.stack) logger.error(reason.stack);
});
process.on('uncaughtException', (err) => {
  logger.error(`[uncaughtException] ${err.message}`);
  if (err.stack) logger.error(err.stack);
  // exit せず continuation (= memory leak / state inconsistency risk と引き換えに crash 回避、
  //   root cause は 個別 handler 側で fix 必須、global は 観測 + last resort)
});

ensureMediaDirs(MEDIA_ROOT);
logger.info(`Media dirs ensured at ${MEDIA_ROOT}`);

// #228 採用者切り分け改善: OPENAI_API_KEY 等が空なら起動時に loud warn
runStartupEnvCheck(logger);

export const app = express();
export const server = http.createServer(app);
export const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? false
      : ['http://localhost:5173', 'http://localhost:5174'],
    methods: ['GET', 'POST'],
  },
});
setIo(io);

// Middleware
app.use(cors());

// Agent Server proxy（express.json() より前に配置 — body をパースせずに転送するため）
app.use('/agent-api', createProxyMiddleware({
  target: `http://localhost:${process.env.AGENT_PORT || 4000}`,
  pathRewrite: { '^/agent-api': '' },
  changeOrigin: true,
}));

// tealus-mcp HTTP transport proxy (#264 Phase 1 alpha)
// Express の app.use('/mcp', ...) は req.url から /mcp prefix を strip するので、
// tealus-mcp 側 (/mcp で listen) に正しく届けるため pathRewrite で re-add する。
// /agent-api / /rtc は target が root path で listen しているので strip 動作で OK だが、
// tealus-mcp は /mcp namespace に揃えているため逆方向の rewrite が必要。
// 認証は pass-through、tealus-mcp 側で JWT_SECRET 共有検証 (fail-fast 401)。
app.use('/mcp', createProxyMiddleware({
  target: `http://localhost:${process.env.MCP_HTTP_PORT || 3200}`,
  changeOrigin: true,
  pathRewrite: (path) => '/mcp' + path,
}));

// LINE Bridge (#288 Phase 1): signature verify 用に raw body 必須、express.json() より前に register
// (= json parser が global で先に走ると req.body が parsed object 化、raw bytes 失われて HMAC 計算 fail)
// routes/line.mts は LINE 公式 spec 準拠で常に 2xx 返却 (= 6/4 200 fix、webhook auto-suspend 防止)
app.use('/api/line', express.raw({ type: 'application/json' }), lineRoutes);

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
// (LINE route は app.use(express.json()) より前に登録済、上部参照)
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
app.use('/media', express.static(process.env.MEDIA_ROOT || path.join(import.meta.dirname, '../../media')));

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
const dashboardDistPath = path.join(import.meta.dirname, '../../dashboard/dist');
app.use('/system', express.static(dashboardDistPath));
// #247: /system (trailing slash なし) も /system/* も index.html を返す
// (client SPA fallback に流れて React Router で / リダイレクトされる bug 防止)
app.get(['/system', '/system/*'], (req, res) => {
  res.sendFile(path.join(dashboardDistPath, 'index.html'));
});

// Serve built React app (production)
const clientDistPath = path.join(import.meta.dirname, '../../client/dist');
app.use(express.static(clientDistPath));
// SPA fallback — all non-API routes return index.html
const clientIndexPath = path.join(clientDistPath, 'index.html');
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/') || req.path.startsWith('/socket.io/') || req.path.startsWith('/system/') || req.path.startsWith('/agent-api/') || req.path.startsWith('/rtc/') || req.path === '/mcp' || req.path.startsWith('/mcp/')) {
    return next();
  }
  // Dev mode では client 未ビルドなので分かりやすいメッセージを返す（通常は Vite dev server 経由でアクセス）
  if (!fs.existsSync(clientIndexPath)) {
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
setupSocketHandlers(io);

// RTC WebSocket upgrade（/rtc/ws パスのみ、Socket.IO と競合しない）
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/rtc/')) {
    rtcProxy.upgrade!(req, socket as import('node:net').Socket, head);
  }
});

// Build artifact sanity check (採用者保護、#234 同型 pattern)
// client/dist や dashboard/dist が無ければ production-style access で 503 / 空白 になるため
// 起動時に loud warn して採用者の install/setup の moor 状態を可視化する
function checkBuildArtifacts(): void {
  const checks = [
    {
      name: 'client',
      path: path.join(import.meta.dirname, '../../client/dist/index.html'),
      hint: 'cd client && npm install (postinstall で auto-build)',
    },
    {
      name: 'dashboard',
      path: path.join(import.meta.dirname, '../../dashboard/dist/index.html'),
      hint: 'cd dashboard && npm install (postinstall で auto-build)',
    },
  ];
  for (const c of checks) {
    if (!fs.existsSync(c.path)) {
      logger.warn(`[build-check] ${c.name}/dist/index.html が見つかりません — ${c.hint}`);
      logger.warn(`[build-check]   production-style access (server 経由 SPA serve) が動作しません。dev mode (vite dev server) を使うなら無視可。`);
    }
  }
}

// Start server (only when run directly, not in tests)
if (import.meta.main) {
  const PORT = process.env.PORT || 3000;
  checkBuildArtifacts();
  server.listen(PORT, () => {
    logger.info(`Tealus server running on port ${PORT}`);
    // rtc-server reachability の動的検出を開始
    import('./services/capabilityWatcher.mts').then(cw => cw.start(io));
    // #327: dictionary テーブルの vocab を in-memory オーバーレイに読み込む (空/不達なら file フォールバック)
    import('./services/transcriptionConfig.mts')
      .then(tc => tc.refreshVocabFromTable())
      .catch((err) => logger.warn(`[dictionary] initial vocab refresh failed: ${err instanceof Error ? err.message : String(err)}`));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} は既に使用中です。`);
      logger.error('既存のプロセスを停止してから再起動してください:');
      logger.error(`  Linux/Mac:  lsof -ti:${PORT} | xargs kill -9`);
      logger.error(`  Windows:    netstat -ano | findstr :${PORT}`);
      logger.error('              (PID 確認後 taskkill /F /PID <pid>)');
      process.exit(1);
    }
    logger.error('Tealus server start error:', err);
    process.exit(1);
  });
}
