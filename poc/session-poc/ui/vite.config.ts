import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // Tauri's dev window loads this address; strictPort keeps it fixed.
  server: { port: 1420, strictPort: true },
  build: {
    // Tauri serves the bundle from the app itself; no external CDN is allowed by the CSP.
    target: 'safari15',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
