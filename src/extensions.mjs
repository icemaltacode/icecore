/* PGlite contrib extensions available to every course.
 *
 * Single source of truth: `bin/icecore.mjs`, `src/build.mjs` and `app/src/db.js` all pass
 * EXTENSIONS to every `new PGlite(...)`, and `app/vite.config.js` derives its
 * optimizeDeps.exclude entries from the same list. Adding an extension is one line here.
 *
 * Registered on EVERY instance, not just the one that seeds a dataset: a data dir dumped
 * with an extension installed still fails to load unless the wasm module is present again
 * (`could not access file "$libdir/tablefunc"`).
 *
 * Keep the list to what courses actually teach. All 32 bundled tarballs total ~2.1MB and
 * add ~220ms to each instance boot; these three are 36KB and ~45ms.
 */
import { tablefunc } from '@electric-sql/pglite/contrib/tablefunc';         // 1.5 CROSSTAB
import { fuzzystrmatch } from '@electric-sql/pglite/contrib/fuzzystrmatch'; // 1.6 levenshtein
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';             // 1.6 similarity

export const EXTENSIONS = { tablefunc, fuzzystrmatch, pg_trgm };

/** Import specifiers for the same set - `exclude` matches the specifier, not the package. */
export const EXTENSION_SPECIFIERS =
  Object.keys(EXTENSIONS).map(name => `@electric-sql/pglite/contrib/${name}`);
