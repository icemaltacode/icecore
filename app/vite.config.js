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
  /* Both wasm runtimes must stay out of pre-bundling: they ship their own .wasm and a
   * pre-bundled copy cannot find it. For pglite, each contrib entry point needs listing
   * separately - exclude matches the import specifier, not the package. */
  optimizeDeps: { exclude: ['@electric-sql/pglite', 'pyodide', ...EXTENSION_SPECIFIERS] },
  /* The grader's wheels are ordinary build assets, imported by `py.js` and emitted with a
   * content hash. They are deliberately NOT in `public/`: `icecore dev` points publicDir at
   * the course's staging directory, so the app's own public/ is not served at all and a
   * fetch for /py/pythonwhat.whl came back as index.html - "File is not a zip file", from
   * micropip, with nothing to say it was an HTML page. Vite has to be told .whl is an asset
   * and not something to parse. */
  assetsInclude: ['**/*.whl'],
});
