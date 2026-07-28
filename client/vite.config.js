import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';

// #356 ビルド ID。バンドルに焼き込む値と dist/version.json に書く値を同一にする。
// 「端末が実行している版」を名乗らせるための識別子で、リリース版数 (git タグ) とは別物。
function resolveBuildId() {
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // git が無い環境 (配布物からのビルド等) でもビルド自体は通す
  }
  // JST 固定。UTC 表示だと実機で見たときに暗算が要る (report/ の時刻方針と揃える)
  const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return `${jst.slice(0, 16).replace('T', ' ')} ${sha}`;
}

/**
 * dist/version.json を吐くだけの最小プラグイン。
 * サーバ (GET /api/version) がこれを読んで「いま配っている版」として返す。
 * SW の precache に含めてはいけない (古い版が返り続けて検知が死ぬ) ので globIgnores で除外する。
 */
function buildIdPlugin(buildId) {
  return {
    name: 'tealus-build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build_id: buildId }) + '\n',
      });
    },
  };
}

// --- 並行デモ実行の仕組み ---
// `npm run dev`       → dev mode   → .env (+ .env.development) を読む
// `npm run dev:demo`  → demo mode  → .env.demo を読む
// .env.demo には VITE_PROXY_TARGET（例: http://localhost:3001）と
// VITE_PORT（例: 5174）を書く。vite.config はこれをここで loadEnv で拾う。
// これで dev server と demo server を同じ PC で並行起動できる。
// 詳細は server/scripts/seed-demo.js のヘッダーコメント参照。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:3000';
  const clientPort = parseInt(env.VITE_PORT || '5173', 10);
  // VITE_ALLOWED_HOSTS=foo.example.com,bar.example.com (comma-separated) で制限可能。
  // 未設定なら true (任意の Host を許可) で dev server に好きな URL でアクセス可能。
  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : true;

  const buildId = resolveBuildId();

  return {
    define: {
      // #356 実行中のバンドルが自分自身を名乗るための定数
      __BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [
      react(),
      buildIdPlugin(buildId),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          navigateFallbackDenylist: [/^\/media\//, /^\/api\//, /^\/system\//, /^\/agent-api\//, /^\/rtc\//, /^\/mcp\//],
          importScripts: ['/custom-sw.js'],
          // #356 version.json を precache に入れると古い版が返り続け、更新検知そのものが死ぬ
          globIgnores: ['**/version.json'],
        },
        manifest: {
          name: 'Tealus',
          short_name: 'Tealus',
          description: '人とAIのためのメッセンジャー',
          theme_color: '#00B4A0',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
          share_target: {
            action: '/share',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
              files: [{ name: 'media', accept: ['image/*', 'video/*'] }],
            },
          },
        },
      }),
    ],
    server: {
      host: true,
      port: clientPort,
      allowedHosts,
      proxy: {
        '/api': proxyTarget,
        '/media': proxyTarget,
        // #257: agent-server (TTS / cancel / cc-projects 等) と rtc-server を Vite dev server からも
        // 見えるように proxy 設定。本番 build → server (3000) 経由では server.js の proxy で動くが、
        // Vite dev server (5173) を採用者が使った時に /agent-api と /rtc が SPA fallback で
        // index.html を返してしまい client が「TTS に失敗しました」default error を表示する trap が
        // 藤井さんの dogfood で発覚。
        '/agent-api': proxyTarget,
        '/rtc': proxyTarget,
        // tealus-mcp HTTP transport (#264) — Vite dev server からも /mcp が見えるように
        '/mcp': proxyTarget,
        '/socket.io': {
          target: proxyTarget,
          ws: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test-setup.ts',
    },
  };
});
