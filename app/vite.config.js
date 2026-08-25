import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { EXTENSION_SPECIFIERS } from '../src/extensions.mjs';

// root and publicDir are supplied by bin/icecore.mjs - publicDir points at the
// built content of whichever course repo is being served.
export default defineConfig({
  plugins: [vue()],
  define: {
    // amazon-cognito-identity-js reaches for the `buffer` polyfill, which expects Node's
    // `global`. Without this the app dies at import time with "global is not defined" and
    // renders nothing at all.
    global: 'globalThis',

    /* THIS ONE IS LOAD-BEARING AND IT LOOKS LIKE A NO-OP. Removing it breaks every SQL
     * exercise in production with `process is not defined`, while dev keeps working.
     *
     * Vite defines `globalThis.process.env` as `{}` for a client build, and `{}` is TRUTHY.
     * PGlite guards its save-and-restore of Node's exit code with exactly that expression:
     *
     *     globalThis.process?.env && (saved = process.exitCode)
     *
     * which is a correct browser check until a bundler folds it to a truthy constant - and
     * Vite's define pattern turns `.` into `\??\.`, so the optional chaining does not
     * save it either. The guard then passes and the bare `process` beside it throws, the
     * first time anything boots a database.
     *
     * DEV CANNOT CATCH THIS. `vite:define` returns early for a client transform when the
     * command is not `build`, so the guard survives as written and the query runs. A bug
     * that only exists in the artefact nobody runs locally.
     *
     * `undefined` is also the honest answer: a browser has no `globalThis.process.env`.
     * `NODE_ENV` keeps its own longer key, so Vue still gets its production build. */
    'globalThis.process.env': 'undefined',
  },
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
