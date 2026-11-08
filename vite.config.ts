import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: { rollupOptions: { input: { reference: resolve(root, 'index.html'), live: resolve(root, 'live.html') } } },
  worker: { format: 'es' },
});
