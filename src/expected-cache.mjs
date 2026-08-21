/* Precomputed expected result sets, kept between builds.
 *
 * WHY THIS EXISTS. `build.mjs` grades every reference solution at build time by running it
 * in PGlite, because grading live in the browser would mean booting a database per check.
 * That is the right trade for the student and a bad one for whoever is editing the course:
 * booting a PGlite instance costs seconds in Node, the course has ~380 exercises across ~30
 * datasets, and `icecore dev` pays the whole bill again on every restart even when nothing
 * touching SQL has changed. Four minutes to see a one-line copy edit is how a dev loop stops
 * being used.
 *
 * So the results are cached on disk, keyed by everything they are derived from. A hit skips
 * the instance entirely - not just the query, the boot - which is where the time actually
 * goes.
 *
 * WHY THE KEY IS PER-EXERCISE AND NOT PER-STEP. Steps of one exercise share a database:
 * only a DDL step gets a clean one, so an `INSERT` in step 2 changes what step 3 selects. A
 * per-step key would hit on step 3 while step 2's edit had changed the rows underneath it,
 * and the cached result would be confidently wrong. Hashing the exercise - dataset, setup,
 * and every step's solution in order - makes that impossible. Exercises have a handful of
 * steps, so the coarser granularity costs almost nothing.
 *
 * The dataset SQL is hashed by CONTENT rather than by name: re-extracting a table changes
 * the rows without changing a character of the exercise, and that has to invalidate.
 * `nondeterministic` is in the key too - it decides whether values are carried at all.
 *
 * FAILURES ARE CACHED as well as successes. A solution that errors costs the same boot as
 * one that works, and `verify` is the tool you run repeatedly while fixing exactly those.
 * Replay reproduces the warning text and the counters exactly, so a cached run and a cold
 * run are indistinguishable in the output - which is the only thing that makes this safe to
 * leave on by default.
 *
 * Set ICECORE_NO_CACHE=1 to bypass it. If a cached result is ever wrong, that is a bug in
 * the key and worth fixing there rather than working around.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/* Bump when the shape of a cached entry changes, or when anything in the compute path
 * changes what a result MEANS - the 1000-row cap, the `ordered` rule, what counts as DDL.
 * Old entries then miss rather than being reinterpreted. */
const FORMAT = 'v1';

/* PGlite's own version is part of the key: it is the thing actually executing the SQL, and
 * a bump can legitimately change a result - column type inference, sort stability, the
 * bundled Postgres itself. Read from the INSTALLED package rather than icecore's dependency
 * range, which stays `^0.2.x` while npm floats the patch underneath it.
 *
 * The package blocks `./package.json` in its exports map, so it is found by walking up from
 * the resolved entry point rather than resolved directly. */
let version = null;
function pgliteVersion() {
  if (version) return version;
  version = 'unknown';
  try {
    let dir = path.dirname(createRequire(import.meta.url).resolve('@electric-sql/pglite'));
    for (let i = 0; i < 5 && dir !== path.dirname(dir); i++, dir = path.dirname(dir)) {
      const p = path.join(dir, 'package.json');
      if (!fs.existsSync(p)) continue;
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg.name === '@electric-sql/pglite' && pkg.version) { version = pkg.version; break; }
    }
  } catch { /* leave 'unknown': a key that matches nothing real is the safe failure */ }
  return version;
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Open the cache for one course.
 *
 * It lives beside the build staging directories in the COURSE repo, which is already
 * gitignored - this is derived data belonging to a checkout, not to the course and not to
 * the platform. Never inside icecore: one platform serves many courses.
 */
export function openExpectedCache({ contentDir, extensions = [], log = () => {} }) {
  const enabled = process.env.ICECORE_NO_CACHE !== '1';
  const dir = path.join(contentDir, '..', '.icecore', 'cache', 'expected');
  /* Everything global to the run, folded in once rather than hashed per exercise.
   * Extensions are sorted because the SET is what matters and the array's order is not. */
  const runKey = [FORMAT, pgliteVersion(), [...extensions].sort()];
  const used = new Set();
  let hits = 0, writes = 0;

  /* Hashed through JSON rather than by joining with a separator. Any separator that can
   * occur inside a solution lets two different exercises serialise to the same bytes -
   * SQL can contain anything, including whatever character looked improbable enough. JSON
   * escapes and delimits the fields for us, so the encoding is unambiguous by construction.
   *
   * The dataset is pre-hashed rather than embedded: it runs to megabytes and would
   * otherwise be re-serialised once per exercise using it. */
  /* The SCT is carried only when a step has one, so a SQL exercise hashes to exactly what
   * it hashed to before Python grading existed. Adding a field unconditionally would have
   * been tidier and would have invalidated every SQL entry in the cache - 218 seconds of
   * recompute for a change that cannot affect a single one of them. */
  const keyFor = (datasetSql, setup, steps) => sha(JSON.stringify([
    runKey,
    sha(datasetSql || ''),
    setup || '',
    (steps || []).map(s => s.sct
      ? [s.solution || '', !!s.nondeterministic, s.sct]
      : [s.solution || '', !!s.nondeterministic]),
  ]));

  const file = key => path.join(dir, `${key}.json`);

  /* Registers the key as live whether or not it hits, so `sweep` can tell an entry this
   * course no longer wants from one it simply has not written yet. */
  const get = key => {
    used.add(key);
    if (!enabled) return null;
    try {
      const hit = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      hits++;
      return hit;
    } catch { return null; }
  };

  /* Written through a temp file and renamed. Several sessions build this checkout at once,
   * and a half-written entry read by the other one would parse as garbage or - far worse -
   * as a truncated but structurally valid result set. */
  const put = (key, outcome) => {
    if (!enabled) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file(key)}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(outcome));
      fs.renameSync(tmp, file(key));
      writes++;
    } catch { /* a cache that cannot be written is still a working build */ }
  };

  /* Drop entries for exercises that no longer exist in this shape. Without it the directory
   * grows by one entry per edit forever - the whole course is only ~8MB of result sets, so
   * this is about staying bounded rather than about speed.
   *
   * Safe against a concurrent build only because both are building the same content and so
   * ask for the same keys; the worst a race can do is force one miss. */
  const sweep = () => {
    if (!enabled) return;
    let dropped = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || used.has(f.slice(0, -5))) continue;
        fs.rmSync(path.join(dir, f), { force: true });
        dropped++;
      }
    } catch { return; }
    if (dropped) log(`  cache: dropped ${dropped} stale entr${dropped === 1 ? 'y' : 'ies'}`);
  };

  return { enabled, keyFor, get, put, sweep, stats: () => ({ hits, writes }) };
}
