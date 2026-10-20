import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * AI サーバのプロキシ先（Phase 4 で有効化）。
 * 例: AI_SERVER_URL=http://localhost:8787
 */
const AI_SERVER_URL = process.env.AI_SERVER_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8010,
    strictPort: true,
    allowedHosts: ['localserver'],
    proxy: {
      // クライアントは VITE_AI_BASE_URL 未設定時モック応答を使うため、
      // プロキシはバックエンド実装後に利用する。
      '/ai': {
        target: AI_SERVER_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai/, ''),
      },
    },
  },
});
