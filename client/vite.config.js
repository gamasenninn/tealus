import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        description: '社内メッセンジャー',
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
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['linny.hksagri.diskstation.me', 'tealus.hksagri.diskstation.me'],
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
  },
});
