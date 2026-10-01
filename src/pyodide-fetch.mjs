/* THE FULL PYODIDE DISTRIBUTION ON THIS MACHINE: found, or fetched once.
 *
 * WHY THE FULL ONE, LOCALLY TOO. `npm i pyodide` ships the runtime and NO packages - the wasm,
 * the stdlib, the loader and a lock file naming 356 wheels it does not contain. `dev` used to
 * fall back to `node_modules/pyodide` whenever the full distribution was not unpacked, on the
 * belief that npm shipped the two dozen packages the courses use. It does not. What a checkout
 * had there was a SIDE EFFECT: Pyodide running under Node fetches any package it is missing
 * from jsDelivr and saves it into its own package directory, and the builder's Python
 * validation runs under Node - so a machine that had graded a course held that course's
 * wheels, and a fresh `npm ci` held none. Python in `dev` then worked or did not depending on
 * what this machine happened to have graded, and failed as "No module named micropip", which
 * names nothing you could search for.
 *
 * So `dev` and `bundle` stage what production serves - the release tarball `just pyodide`
 * puts in the bucket - and nothing else. Nothing reads the wheels in node_modules/pyodide any
 * more; they are the builder's private cache, and whatever is in there is fine.
 *
 * ONCE PER VERSION PER MACHINE, in a cache shared by every checkout: a course repo's own
 * copy of icecore is under node_modules and `npm ci` deletes it, so a copy kept there would
 * be fetched again on every install. A checkout that already unpacked one into `.pyodide/`
 * (where `just pyodide` used to put it) keeps using that rather than fetching it twice.
 *
 * Node-only, unlike `pyodide-dist.mjs`, which the player also imports.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

export const releaseUrl = version =>
  `https://github.com/pyodide/pyodide/releases/download/${version}/pyodide-${version}.tar.bz2`;

/** Where fetched distributions live: `$ICECORE_PYODIDE_CACHE`, or the user's cache directory. */
export const cacheRoot = () => process.env.ICECORE_PYODIDE_CACHE
  || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'icecore', 'pyodide');

const complete = dir => fs.existsSync(path.join(dir, 'pyodide-lock.json'));

/** The distribution's directory if this machine already has one, without fetching anything. */
export function findDistribution(version, { root } = {}) {
  const own = root && path.join(root, '.pyodide', version);
  if (own && complete(own)) return own;
  const shared = path.join(cacheRoot(), version);
  return complete(shared) ? shared : null;
}

/**
 * The distribution's directory, fetching and unpacking the release first if this machine has
 * none. `log` hears what is happening, because a first run downloads a few hundred megabytes
 * and a silent minute reads as a hang. `url` is the release's own unless a test says otherwise.
 *
 * Safe to run twice at once. Everything is written beside its target under a name of its own
 * and moved into place whole, so an interrupted run leaves nothing a later one would mistake
 * for complete, and two runs racing both finish with one good copy.
 */
export async function ensureDistribution(version, { root, log = console.log,
                                                    url = releaseUrl(version) } = {}) {
  const found = findDistribution(version, { root });
  if (found) return found;

  const base = cacheRoot();
  const dir = path.join(base, version);
  const mine = `${process.pid}-${Date.now()}`;
  fs.mkdirSync(base, { recursive: true });

  const tar = path.join(base, `pyodide-${version}.${mine}.tar.bz2`);
  log(`  python ${version}: fetching the full distribution, once for this machine`);
  log(`    ${url}`);
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`cannot fetch ${url} (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  let got = 0;
  let said = 0;
  const progress = new Transform({
    transform(chunk, _, done) {
      got += chunk.length;
      if (got - said >= 50 * 1048576) {
        said = got;
        log(`    ${Math.round(got / 1048576)}MB${total ? ` of ${Math.round(total / 1048576)}MB` : ''}`);
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body), progress, fs.createWriteStream(tar));

    log('    unpacking');
    const part = `${dir}.${mine}`;
    fs.mkdirSync(part, { recursive: true });
    try {
      // The tarball's own root is `pyodide/`; stripped, so the version directory IS the files.
      execFileSync('tar', ['-xjf', tar, '-C', part, '--strip-components=1'], { stdio: 'inherit' });
      if (!complete(part)) throw new Error(`no pyodide-lock.json in ${url}`);
      // Somebody else may have finished first, and theirs is as good as ours.
      if (complete(dir)) fs.rmSync(part, { recursive: true, force: true });
      else { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(part, dir); }
    } catch (e) {
      fs.rmSync(part, { recursive: true, force: true });
      throw e;
    }
  } finally {
    fs.rmSync(tar, { force: true });
  }
  const wheels = fs.readdirSync(dir).filter(n => n.endsWith('.whl')).length;
  log(`    ${wheels} packages in ${dir}`);
  return dir;
}
