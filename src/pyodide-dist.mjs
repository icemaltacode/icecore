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
 * THE WHOLE DISTRIBUTION, not a curated subset. An earlier version of this staged the
 * twenty-four packages npm happens to bundle and trimmed the lock file to match, on the
 * reasoning that the six the courses declare were covered and 334MB is a lot of bucket. That
 * was the wrong call and not one this file gets to make: jsDelivr served all 356, so a
 * subset is a REGRESSION dressed as a saving - the Playground exists precisely so a student
 * can import what they like, and `import networkx` failing on our own site is not something
 * they can be expected to understand.
 *
 * So the rule is simply that what used to come from jsDelivr now comes from icecampus.com,
 * and nothing else changes. `just pyodide` puts the release tarball in the bucket, which is
 * behind CloudFront, which is a CDN - the one thing that was ever wanted here.
 *
 * WHICH IS WHY THE LOCK FILE IS COPIED RATHER THAN REWRITTEN. It describes the distribution
 * and the distribution is now all of it, so there is nothing to reconcile and no chance of
 * this side and the bucket disagreeing about which packages exist.
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
