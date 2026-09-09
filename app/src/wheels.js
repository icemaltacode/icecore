/* WHERE PYTHON COMES FROM: the runtime, and the wheels this repo vendors on top of it.
 *
 * SHARED, because there are two interpreters now - the grader and the Playground - and both
 * need seaborn and pingouin from the same place. It was a private glob inside `py.js` until
 * the Playground wanted one too, which is the moment a private thing becomes a module
 * rather than a second copy.
 *
 * ASSETS, NOT `public/`. `icecore dev` points Vite's publicDir at the COURSE's staging
 * directory, so the app's own `public/` is not served at all - a fetch for
 * `/py/pythonwhat.whl` came back as the app's index page, and micropip reported "File is
 * not a zip file" with nothing pointing at the cause. Imported as assets instead: Vite
 * resolves them in dev and emits them with a content hash in a build, and neither depends
 * on publicDir.
 *
 * Globbed rather than listed, so adding a wheel is a file rather than a file plus two edits.
 *
 * THE RUNTIME'S OWN URL LIVES HERE FOR THE SAME REASON THE WHEELS DO. Both interpreters need
 * it and it was written out twice, identically, in `py.js` and `playground-py.js` - which is
 * one edit away from a Playground that boots from somewhere the grader does not.
 */
import { pyodideDir } from '../../src/pyodide-dist.mjs';
import { version } from 'pyodide';
const WHEEL_URLS = Object.fromEntries(
  Object.entries(import.meta.glob('../py/*.whl', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.split('/').pop(), url]));

/**
 * What `loadPyodide` is given as `indexURL` - our own origin, never a CDN.
 *
 * See src/pyodide-dist.mjs for why. `BASE_URL` rather than a bare `/` because the player is
 * built with a base and a deck is not the only thing that can be served from a subpath; the
 * trailing slash is required - Pyodide concatenates filenames onto this string.
 *
 * ABSOLUTE, and that is not tidiness. Pyodide resolves each wheel with `new URL(file_name,
 * packageBaseUrl)`, and a relative base makes that throw `Invalid URL` - so every package
 * fails to fetch while the runtime itself boots perfectly, because `indexURL` IS put through
 * the loader's own resolver and `packageBaseUrl` is not (`initializeConfiguration` does
 * `k(w(t))` for one and a bare `k()` for the other). What that looks like is Python starting
 * and then "No module named micropip", which names nothing you could search for.
 *
 * The version is the installed package's, so this cannot name a distribution the bundled
 * loader was not compiled against - which would fail as a missing wasm export, a long way
 * from its cause.
 */
export const pyodideIndexUrl = () => {
  const at = `${import.meta.env.BASE_URL}${pyodideDir(version)}/`;
  return typeof location === 'undefined' ? at : new URL(at, location.href).href;
};

/**
 * What `loadPyodide` is given, in full - and `packageBaseUrl` is NOT redundant.
 *
 * Packages already resolve against `indexURL` - they are relative to `lockFileURL`, which
 * defaults from it - but `cdnUrl` is computed as `packageBaseUrl ?? cdn.jsdelivr.net/...`, so
 * with `packageBaseUrl` unset a jsDelivr URL survives in the runtime's own config as the
 * fallback for anything the lock file does not name. That is precisely the dependency this
 * removes, and it would have stayed in as the one path nobody tested.
 *
 * Setting it means a wheel that is not staged 404s against our own origin rather than quietly
 * succeeding from a CDN. That is the failure we want: a hidden CDN dependency is invisible
 * everywhere except on the network that blocks it.
 */
export const pyodideOptions = () => {
  const indexURL = pyodideIndexUrl();
  return { indexURL, packageBaseUrl: indexURL };
};

export const wheelUrl = name => WHEEL_URLS[name]
  || (() => { throw new Error(`no vendored wheel named ${name}`); })();

/** Fetch one vendored wheel as bytes, ready for micropip's `emfs:` scheme. */
export async function readWheel(name) {
  const r = await fetch(wheelUrl(name));
  if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
