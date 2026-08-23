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
import { pool } from './db/pool.mts';
import { checkMigrations } from './services/migrationCheck.mts';
import { ensureMediaDirs } from './utils/mediaSetup.mts';
import { MEDIA_ROOT } from './middleware/upload.mts';
import { runStartupEnvCheck } from './utils/envCheck.mts';
import { setupSocketHandlers } from './socket/index.mts';
import { setIo } from './io-registry.mts';
import { createSignalHandler, realSleep, realDeadline } from './utils/shutdown.mts';
import { notifyGatewayBye } from './utils/gatewayBye.mts';
import { describeProxyClose, isCcStreamPath } from './utils/ccStreamProxyLog.mts';
import { JWT_SECRET } from './middleware/auth.mts';

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
import { router as promptRoutes } from './routes/prompts.mts';
import { applyStaticCacheHeaders, NO_STORE } from './utils/staticCache.mts';
import { router as versionRoutes } from './routes/version.mts';
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
//
// ★ cc-stream (長時間接続) だけ切断ログを出す (#359 B-1)。この 3000 番は 8 月の
//   切断調査の間ずっと無言で、「何も起きていない」と「記録していない」が区別できなかった。
//   ここで書くのは **どちら側が先に閉じたか** だけ。原因は分からないので書かない。
//   ★★ 全 API に付けない —— 短命リクエストの行に埋もれた計器は無いのと同じ。
app.use('/agent-api', createProxyMiddleware({
  target: `http://localhost:${process.env.AGENT_PORT || 4000}`,
  pathRewrite: { '^/agent-api': '' },
  changeOrigin: true,
  on: {
    proxyReq: (_proxyReq, req, res) => {
      if (!isCcStreamPath(req.url ?? '')) return;
      const facts = { url: req.url ?? '', startedAt: Date.now(), bytes: 0 } as {
        url: string; startedAt: number; bytes: number;
        clientClosedAt?: number; upstreamClosedAt?: number; error?: string;
      };
      // ★ 1 リクエストに 1 つだけ持たせる。proxyRes / error / close の 3 か所から書き込む
      (req as unknown as { _ccProxyFacts?: typeof facts })._ccProxyFacts = facts;
      req.on('close', () => { facts.clientClosedAt ??= Date.now(); });
      // ★ 書き出しは res の close 1 か所に集約する。両側のフラグが揃ってから 1 行だけ出す
      //   (2 か所から出すと、同着のときに 2 行出て件数が倍になる)
      res.on('close', () => { logger.info(describeProxyClose({ ...facts, now: Date.now() })); });
    },
    proxyRes: (proxyRes, req) => {
      const facts = (req as unknown as {
        _ccProxyFacts?: { bytes: number; upstreamClosedAt?: number };
      })._ccProxyFacts;
      if (!facts) return;
      // pipe で既に flowing なので、listener を足しても取りこぼさない (観測だけ)
      proxyRes.on('data', (chunk: Buffer) => { facts.bytes += chunk.length; });
      proxyRes.on('close', () => { facts.upstreamClosedAt ??= Date.now(); });
    },
    error: (err, req) => {
      const facts = (req as unknown as { _ccProxyFacts?: { error?: string } })._ccProxyFacts;
      if (facts) facts.error ??= err.message;
    },
  },
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
app.use('/api/version', versionRoutes);
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
app.use('/api/rooms/:id/prompts', promptRoutes);

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
app.use('/system', express.static(dashboardDistPath, { setHeaders: applyStaticCacheHeaders }));
// #247: /system (trailing slash なし) も /system/* も index.html を返す
// (client SPA fallback に流れて React Router で / リダイレクトされる bug 防止)
app.get(['/system', '/system/*'], (req, res) => {
  res.sendFile(path.join(dashboardDistPath, 'index.html'), { headers: { 'Cache-Control': NO_STORE } });
});

// Serve built React app (production)
// #355 キャッシュ方針はファイルの性質で分ける (index.html/sw = no-store, ハッシュ付き assets = immutable)
const clientDistPath = path.join(import.meta.dirname, '../../client/dist');
app.use(express.static(clientDistPath, { setHeaders: applyStaticCacheHeaders }));
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
  // SPA fallback も更新の入口なので保存させない (#355)
  res.sendFile(clientIndexPath, { headers: { 'Cache-Control': NO_STORE } });
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

  // #368 停止時に止める watcher。起動時に読み込んだ module をそのまま覚えておく
  // (ここで static import すると、モジュール読込時に env を読む都合 (docs/05 §2a) と
  //  起動順が変わるため、既存の動的 import の結果を捕まえる形にしている)
  let capabilityWatcher: typeof import('./services/capabilityWatcher.mts') | null = null;
  let organonWatcher: typeof import('./services/organonWatcher.mts') | null = null;
  let roomTriggers: typeof import('./services/roomTriggerRunner.mts') | null = null;

  server.listen(PORT, () => {
    logger.info(`Tealus server running on port ${PORT}`);
    // #334: 未適用 migration の loud warn (採用者保護)。辞書テーブル不在を起動時に可視化
    // (silent degrade 防止)。稼働は止めない — warn のみ。
    void checkMigrations({ query: (sql) => pool.query(sql), warn: (m) => logger.warn(m) })
      .catch((err) => logger.warn(`[migration-check] 確認をスキップ: ${err instanceof Error ? err.message : String(err)}`));
    // rtc-server reachability の動的検出を開始
    import('./services/capabilityWatcher.mts').then(cw => { capabilityWatcher = cw; cw.start(io); });
    // #327: dictionary テーブルの vocab を in-memory オーバーレイに読み込む (空/不達なら file フォールバック)
    import('./services/transcriptionConfig.mts')
      .then(tc => tc.refreshVocabFromTable())
      .catch((err) => logger.warn(`[dictionary] initial vocab refresh failed: ${err instanceof Error ? err.message : String(err)}`));
    // #331: organon dock watcher。organon.ttl (RDF 契約) の到着で辞書テーブルへ pull + overlay reload。
    // 起動時に 1 回 pull するので上の initial refresh を subsume する (ORGANON_TTL_PATH 未設定なら no-op)。
    import('./services/organonWatcher.mts').then(ow => { organonWatcher = ow; ow.start(); });
    // #382 ルームトリガー: 条件が満たされたら定型メッセージを投稿する。
    // 設定 (server/config/room-triggers.json) が無ければ何もしない = 既定では止まったまま。
    import('./services/roomTriggerRunner.mts')
      .then(rt => { roomTriggers = rt; rt.startRoomTriggers(); })
      .catch((err) => logger.warn(`[room-triggers] 起動に失敗: ${err instanceof Error ? err.message : String(err)}`));
  });

  // ★ #368 graceful shutdown。これが無いと停止時にハンドラを通らずプロセスが死に、
  //   接続・タイマー・DB プールが後始末されない。とくに cc-queue の**中継**は
  //   本体サーバのプロセスが握っているため、別マシンの CC セッションが予告なしで切れる
  //   (2026-08-04 に `curl=92` = HTTP/2 ストリーム破損として実測)。
  //   ★ 登録は import.meta.main の中だけ — app.mts は test が import するので、
  //     トップレベルで process.on すると test 実行中にハンドラが登録される。
  const onSignal = createSignalHandler({
    log: (m) => logger.info(m),
    warn: (m) => logger.warn(m),
    // ★ 予告は「中継が生きているうち」に通す。接続を切ってからでは届かない
    notifyGateway: async () => {
      const notified = await notifyGatewayBye({
        port: process.env.AGENT_PORT || 4000,
        secret: JWT_SECRET,
        expectBackMs: parseInt(process.env.CC_GATEWAY_EXPECT_BACK_MS || '', 10) || 30000,
      });
      if (notified > 0) logger.info(`[shutdown] cc-queue の購読者 ${notified} 件に再起動を予告しました`);
    },
    stopTimers: () => { capabilityWatcher?.stop(); organonWatcher?.stop(); roomTriggers?.stopRoomTriggers(); },
    // ★ server.close() は await しない — cc-queue の中継は終わらないので callback が来ない
    closeServer: () => { server.close(); },
    closeConnections: () => { server.closeAllConnections(); },
    closeIo: () => { io.close(); },
    endPool: () => pool.end(),
    sleep: realSleep,
    deadline: realDeadline,
    exit: (code) => process.exit(code),
  });
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

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
