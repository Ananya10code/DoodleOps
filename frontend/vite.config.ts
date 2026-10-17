import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' }, // sockjs-client expects a Node-style `global`
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws-whiteboard': { target: 'http://localhost:8080', ws: true },
    },
  },
});
