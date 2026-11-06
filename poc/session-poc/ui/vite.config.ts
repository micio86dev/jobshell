import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    // Tauri serves the bundle from the app itself; no external CDN is allowed by the CSP.
    target: 'safari15',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
