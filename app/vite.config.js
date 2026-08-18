import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// root and publicDir are supplied by bin/icecore.mjs - publicDir points at the
// built content of whichever course repo is being served.
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },   // ships wasm; must not be pre-bundled
});
