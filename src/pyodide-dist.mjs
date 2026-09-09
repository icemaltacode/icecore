/* WHERE PYTHON COMES FROM, and it is our own origin.
 *
 * The loader is bundled by Vite, but a Pyodide loader is only the front door: `loadPyodide`
 * then fetches `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json` and a wheel per
 * package from whatever `indexURL` names. That was
 * `https://cdn.jsdelivr.net/pyodide/v<version>/full/`, which is what DataCamp's own player
 * does and which is fine right up until it is not: a student behind a corporate or school
 * network that blocks CDNs gets a Python exercise that never boots, on a site that is
 * otherwise working perfectly. ONEY is that network. It is not a slow load or a degraded
 * experience - the interpreter never arrives, so every coding exercise in the course is
 * simply broken for that student and for nobody else, which is the hardest kind of fault to
 * be told about.
 *
 * WE ALREADY HAVE THE FILES. `npm i pyodide` ships the runtime AND the twenty-four wheels
 * Pyodide bundles - pandas, numpy, matplotlib, scipy, statsmodels, pyarrow and their
 * dependencies - so this is a copy, not a download. Nothing is fetched at build time and
 * nothing new has to be kept up to date: the version in `package.json` is the version that
 * ships, and it cannot drift from the loader compiled against it.
 *
 * ALL TWENTY-FOUR NPM SHIPS, not the six the courses name. The Playground exists so a
 * student can import what they like, and the six are only what an exercise DECLARES. 65MB in
 * a bucket that holds 520MB of deck PDFs.
 *
 * BUT NOT ALL 356 PYODIDE HAS, and that is a real narrowing rather than an oversight. The
 * lock file describes Pyodide's whole catalogue - networkx, beautifulsoup4, opencv, astropy -
 * and jsDelivr served every one of them. The full distribution is a 334MB download, and
 * shipping it is a decision about the bucket rather than about this file, so it is left as
 * one: the staging step below would only have to copy more files.
 *
 * WHAT THE NARROWING MUST NOT DO IS LIE. Left whole, the lock file goes on naming 332
 * packages we do not have, so `loadPackagesFromImports` resolves one, fetches it from our
 * own origin and gets a 404 - a network error blamed on the platform for a package that was
 * never there. So the staged lock file is TRIMMED to what is beside it, and an import of
 * anything else fails as a plain `ModuleNotFoundError`, which is the truth.
 *
 * The npm set is dependency-closed - checked in test/setup-checks.mjs, because a trim that
 * broke the closure would install a package whose dependency 404s, which is the same fault
 * wearing a better disguise.
 *
 * THE PREFIX CARRIES THE VERSION, which is what makes these files cacheable forever and a
 * version bump a new set of URLs rather than a stale one. Same trade `assets/*` already
 * makes, for the same reason - except that these cannot be content-hashed into `assets/`:
 * Pyodide builds its own URLs by name from the lock file, so the names have to survive.
 *
 * PURE AND DEPENDENCY-FREE, like `extensions.mjs`, because both ends need it: the CLI stages
 * the files and the player asks for them, and the two agreeing about the path by coincidence
 * is how a deployment ships an interpreter nothing can find.
 */

/**
 * Where the distribution is published, relative to the site root. No leading slash - the
 * player resolves it against `BASE_URL` and the CLI against a staging directory.
 */
export const pyodideDir = version => `pyodide/${version}`;

/**
 * Whether one file of the npm package is part of the distribution a browser needs.
 *
 * An ALLOWLIST would have to name `pyodide.asm.wasm` and every wheel by its exact wasm ABI
 * tag - `numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl` - and would go stale on
 * every upgrade, silently, as a missing package rather than as a missing file. What is
 * excluded is small, stable and obvious instead: source maps, type declarations and the two
 * demo consoles. Erring towards shipping a file nobody fetches costs a few kilobytes in a
 * bucket; erring the other way costs a package that cannot be imported.
 */
export const shipped = name =>
  !/\.(map|d\.ts|html)$/.test(name) && name !== 'README.md' && name !== 'package.json';

/**
 * The lock file as it should be published: only the packages actually staged beside it.
 *
 * Pure, and takes the parsed lock plus the filenames that are there, so the CLI can write it
 * and a test can assert on it without either owning the rule.
 */
export function trimLock(lock, filenames) {
  const there = filenames instanceof Set ? filenames : new Set(filenames);
  const packages = Object.fromEntries(
    Object.entries(lock.packages || {}).filter(([, p]) => there.has(p.file_name)));
  return { ...lock, packages };
}

/**
 * Any dependency a trimmed lock names but no longer contains.
 *
 * Empty is the only acceptable answer: a package whose dependency was trimmed away installs
 * and then fails to import, which reads as the package being broken rather than as the trim.
 */
export function dangling(lock) {
  const names = new Set(Object.keys(lock.packages || {}));
  return Object.entries(lock.packages || {}).flatMap(([n, p]) =>
    (p.depends || []).filter(d => !names.has(d)).map(d => `${n} -> ${d}`));
}
