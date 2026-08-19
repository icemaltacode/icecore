import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { EXTENSION_SPECIFIERS } from '../src/extensions.mjs';

// root and publicDir are supplied by bin/icecore.mjs - publicDir points at the
// built content of whichever course repo is being served.
export default defineConfig({
  plugins: [vue()],
  // amazon-cognito-identity-js reaches for the `buffer` polyfill, which expects Node's
  // `global`. Without this the app dies at import time with "global is not defined" and
  // renders nothing at all.
  define: { global: 'globalThis' },
  // pglite ships wasm and must not be pre-bundled; each contrib entry point needs
  // listing separately, since exclude matches the import specifier, not the package
  optimizeDeps: { exclude: ['@electric-sql/pglite', ...EXTENSION_SPECIFIERS] },
});
