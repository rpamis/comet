import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: path.join(here, 'public'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(here, '../../../dist/domains/dashboard/web'),
    emptyOutDir: true,
    rollupOptions: {
      // jsdom is Node-only fallback for Vitest; never ship it in the dashboard bundle.
      external: ['jsdom'],
    },
  },
  optimizeDeps: {
    exclude: ['jsdom'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:4399',
    },
  },
});
