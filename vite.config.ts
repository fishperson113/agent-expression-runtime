import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const headers = { 'Content-Security-Policy': "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" };

export default defineConfig({
  build: { rollupOptions: { input: { reference: resolve(root, 'index.html'), live: resolve(root, 'live.html') } } },
  worker: { format: 'es' },
  server: { headers },
  preview: { headers },
});
