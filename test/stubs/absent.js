/* The wasm runtimes, aliased away in a test process.
 *
 * PGlite and Pyodide are megabytes of wasm inlined as data URIs by the bundler, and nothing
 * about the player's own behaviour - where a student is, whether they are following, what
 * the room says - depends on either. Aliased rather than imported and left unused, because
 * "unused" still costs the parse: with them in, a bundle of App.vue is 53MB.
 *
 * EVERY EXPORT IS NAMED, because a static `import { PGlite }` is resolved by the bundler and
 * a catch-all Proxy cannot answer it. The list is the union of what `app/src/db.js`,
 * `app/src/py.js`, `app/src/playground-*.js` and `src/extensions.mjs` import - so a new
 * import from either package fails the BUILD of the test rather than at some later moment,
 * which is the right way round.
 *
 * THEY THROW RATHER THAN RETURNING NOTHING. A stub that quietly answers is a test that can
 * go green against a code path it never took; these name themselves in the error, so a test
 * that has wandered into booting a database says so.
 */
const absent = name => new Proxy(function () {}, {
  get(_, key) {
    if (key === 'then') return undefined;   // so `await import()` does not try to unwrap it
    if (key === Symbol.toStringTag) return 'Absent';
    if (key === 'prototype') return {};
    return absent(`${name}.${String(key)}`);
  },
  apply() { throw new Error(`${name}() is not available in a test process - see test/stubs/absent.js`); },
  construct() { throw new Error(`new ${name}() is not available in a test process`); },
});

export const PGlite = absent('PGlite');
export const loadPyodide = absent('loadPyodide');
export const version = '0.0.0-absent';
// The three contrib extensions `src/extensions.mjs` registers on every instance.
export const tablefunc = absent('tablefunc');
export const fuzzystrmatch = absent('fuzzystrmatch');
export const pg_trgm = absent('pg_trgm');
export default absent('default');
