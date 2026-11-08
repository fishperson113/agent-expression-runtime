import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: { rollupOptions: { input: { reference: resolve('index.html'), live: resolve('live.html') } } },
  worker: { format: 'es' },
});
