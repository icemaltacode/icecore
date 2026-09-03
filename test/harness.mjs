/* Loading the PLAYER into Node, so it can be tested.
 *
 * WHY THIS EXISTS AT ALL: nothing in this repo ever executed the app. Everything under
 * `app/src` that is not pure - `delivery.js`, the channel, App.vue's watchers - had no test
 * of any kind, and three separate bugs shipped in one day in code that had never once run:
 * `nextTick` was never imported so every `applied()` threw and following only appeared to
 * work, a slides row was built without the deck it needs so the player rendered inside
 * itself, and `report()` dropped the slide number so a class stopped following an educator
 * paging a deck. Each was invisible to reading and instant to a test.
 *
 * IT CANNOT BE A PLAIN `import`. `auth.js` reads `import.meta.env.BASE_URL` at module level
 * and `preview.js` reads `import.meta.env.DEV`, which is `undefined.DEV` under Node - so the
 * import throws before a line of the module under test runs. That is the rule CLAUDE.md
 * states from the other side: anything the BUILDER imports out of `app/src` must stay free
 * of `import.meta.env`. This is the door for everything else.
 *
 * SO IT BUILDS, rather than transforming module by module. `ssrLoadModule` is the obvious
 * tool and it is the wrong one here: it compiles an SFC for SSR, and an SSR-compiled
 * component asks for a render context that does not exist and refuses to mount. Vite's
 * client environment run in Node fails differently - the client transform leaves bare
 * `import.meta` in place, which cannot be evaluated as a function body. A real build is the
 * only one of the three that produces the component the browser is actually given.
 *
 * IT TAKES ABOUT TWO SECONDS, and does not need to be quicker. The wasm runtimes are aliased
 * away (see `stubs/absent.js`) which is the difference between a 3MB bundle and a 53MB one,
 * and no test here has any business booting a database or an interpreter.
 */
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const here = p => fileURLToPath(new URL(p, import.meta.url));

/**
 * Build the player and import it. Returns the entry's namespace plus `dispose`.
 *
 * `preview` is the role `import.meta.env.VITE_ICECORE_PREVIEW` is built with - the same
 * switch `icecore dev --as student` throws. THAT IS THE WHOLE STAND-IN: `preview.js` already
 * answers every API call and can script a room, it was written so that no screen is
 * unreachable without a stack behind it, and a test that invented its own fiction instead
 * would be a test of the fiction. The one thing it does not cover is the content itself,
 * which comes off the origin as static JSON - see `serve` in dom.mjs.
 */
export async function buildPlayer({ preview = 'student', base = '/' } = {}) {
  const out = await build({
    root: here('../app'),
    configFile: false,
    logLevel: 'error',
    mode: 'development',
    plugins: [vue()],
    define: {
      'import.meta.env.VITE_ICECORE_PREVIEW': JSON.stringify(preview),
      'import.meta.env.BASE_URL': JSON.stringify(base),
      /* SPELLED OUT, because this is a BUILD and a build is production by default whatever
       * `mode` says. `preview.js` gates its entire stand-in API on `DEV`, so without this
       * `previewRole()` is null, `api()` goes to the network, and the first thing the test
       * sees is a fetch for `/api/live/session` - which reads as the harness being wrong
       * rather than the flag. */
      'import.meta.env.DEV': 'true',
      'import.meta.env.PROD': 'false',
    },
    resolve: {
      /* The two wasm runtimes, and every entry point of either - `optimizeDeps.exclude` in
       * the app's own config has the same shape and the same reason: a match is on the
       * import specifier, not on the package. */
      alias: [
        { find: /^@electric-sql\/pglite(\/.*)?$/, replacement: here('stubs/absent.js') },
        { find: /^pyodide(\/.*)?$/, replacement: here('stubs/absent.js') },
      ],
    },
    build: {
      write: false, minify: false, cssCodeSplit: false, target: 'esnext',
      lib: { entry: here('stubs/player-entry.js'), formats: ['es'], fileName: 'player' },
      // Vue itself stays external so the test and the app share one runtime; two copies
      // would each have their own reactivity and nothing would ever update.
      rollupOptions: { external: ['vue'] },
    },
  });

  const chunk = out[0].output.find(o => o.type === 'chunk' && o.isEntry)
    || out[0].output.find(o => o.type === 'chunk');
  /* Written to disk rather than imported as a data: URL. A 3MB data URL is legal and
   * miserable: every stack trace in a failure becomes one enormous unreadable line.
   *
   * UNDER node_modules, NOT IN A TEMP DIRECTORY. `vue` is left external so that the test and
   * the app share one reactivity system, and a bare `vue` import only resolves from
   * somewhere that can walk up to this repo's node_modules. A file in /tmp cannot. */
  const dir = here('../node_modules/.cache/icecore-player');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `player-${process.pid}.mjs`);
  await writeFile(file, chunk.code);
  const mod = await import(`file://${file}`);
  return { ...mod, dispose: () => rm(file, { force: true }) };
}
