import { defineConfig } from 'vite';

export default defineConfig({
  base: './',           // relative paths so it works under /nomaerooms/ on GH Pages
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
  },
});
