import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  define: {
    'globalThis.__COMET_DASHBOARD_EMBED__': 'true',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: path.resolve(here, '../../../website/assets/dashboard-website-demo'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(here, 'src/website-demo-entry.jsx'),
      name: 'CometDashboardWebsiteBundle',
      formats: ['iife'],
      fileName: () => 'dashboard-website-demo.js',
    },
    rollupOptions: {
      external: ['jsdom'],
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((name) => name.endsWith('.css'))
            ? 'dashboard-website-demo.css'
            : '[name][extname]',
      },
    },
  },
});
