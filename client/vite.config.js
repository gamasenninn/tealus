import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          navigateFallbackDenylist: [/^\/media\//, /^\/api\//, /^\/system\//, /^\/agent-api\//, /^\/rtc\//],
          importScripts: ['/custom-sw.js'],
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
      allowedHosts: ['linny.hksagri.diskstation.me', 'tealus.hksagri.diskstation.me', 'tealus.dev', 'app.tealus.dev'],
      proxy: {
        '/api': proxyTarget,
        '/media': proxyTarget,
        '/socket.io': {
          target: proxyTarget,
          ws: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test-setup.js',
    },
  };
});
