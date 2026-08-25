/* The Python wheels this repo vendors, as build assets.
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
 */
const WHEEL_URLS = Object.fromEntries(
  Object.entries(import.meta.glob('../py/*.whl', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.split('/').pop(), url]));

export const wheelUrl = name => WHEEL_URLS[name]
  || (() => { throw new Error(`no vendored wheel named ${name}`); })();

/** Fetch one vendored wheel as bytes, ready for micropip's `emfs:` scheme. */
export async function readWheel(name) {
  const r = await fetch(wheelUrl(name));
  if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
