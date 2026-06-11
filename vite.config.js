import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    minify: 'esbuild',
  },
  server: {
    host: true,
    port: 5173,
  },
});