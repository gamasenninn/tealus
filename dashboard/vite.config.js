import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/system/',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/agent-api': {
        target: 'http://localhost:4000',
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
      '/media': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
