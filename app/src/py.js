/* The Python interpreter the player grades against, and the data it reads.
 *
 * The same job `db.js` does for SQL, and the same shape: something expensive is built once
 * and shared, and everything downstream of it is keyed by what it was built from. What
 * differs is where the cost sits. PGlite is cheap to boot and expensive to seed, so `db.js`
 * caches seeded data directories. Pyodide is the other way round: booting the interpreter
 * and importing pandas is seconds, and every check after that is milliseconds in the same
 * interpreter. So there is exactly one interpreter per session and it is never rebuilt.
 *
 * WHERE PYODIDE COMES FROM. The loader is bundled; the wasm and the packages are fetched
 * from jsDelivr, which is what DataCamp's own player does - campus.datacamp.com loads
 * cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js. The version is read from the package
 * rather than written down, so the CDN path can never drift from the API we compiled
 * against; a mismatch there would fail as a missing wasm export, a long way from its cause.
 *
 * The one exception is the grader itself. pythonwhat is unmaintained - 2.30.1, and DataCamp
 * does not appear to load it in the browser at all - so nothing keeps it alive on PyPI. It
 * is vendored under `public/py/` and served from our own origin.
 */
import { loadPyodide, version } from 'pyodide';
import { createGrader, seedFor, packageKey } from './python.js';
import { dataBase } from './content.js';
// Shared with the Playground's interpreter - see wheels.js.
import { readWheel } from './wheels.js';

const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;


/* One grader, rebuilt when the exercise needs a different set of packages.
 *
 * NOT grown, and not the union of the unit. A package that is merely importable changes
 * behaviour - pandas takes a different factorize path when pyarrow is present, and on a
 * pickle-loaded frame that path raises "putmask: output array is read-only" from inside
 * pandas, naming nothing you could search for. Unit 2.4 never asks for pyarrow and broke
 * anyway, because a sibling unit did. See `packageKey` in python.js.
 *
 * Pyodide cannot unload a module, so the only way back from an extra package is a fresh
 * interpreter. Topping up is safe in one direction only - adding what THIS exercise
 * declared - and that is not enough, because the next exercise may declare fewer.
 *
 * Exactly one is alive at a time. Keeping a cache of them per package set would avoid the
 * rebuilds and hold tens of megabytes of wasm per entry in a browser tab, which is the
 * wrong trade for something a student crosses at a unit boundary.
 */
let grader = null;
let graderKey = null;
let building = null;

async function graderFor(exercise) {
  const key = packageKey(exercise);
  if (grader && graderKey === key) return grader;
  // Serialised: two exercises starting at once must not build two interpreters.
  if (building) { await building; return graderFor(exercise); }
  building = (async () => {
    const pyodide = await loadPyodide({ indexURL: INDEX_URL });
    const g = await createGrader({
      pyodide,
      packages: exercise.packages || [],
      wheels: exercise.wheels || [],
      readWheel,
    });
    grader = g; graderKey = key; mounts.clear();   // a new interpreter has an empty filesystem
    return g;
  })();
  try { return await building; } finally { building = null; }
}

/* A unit's data files, fetched once and written into the interpreter's filesystem.
 *
 * Keyed by unit rather than by topic because that is how they are published: the files are
 * shared inside a unit, and 2.4's casts.p is 8.6MB. Fetched lazily - a student doing 2.1
 * never pays for 2.4's pickles - and cached by the promise, so two exercises starting at
 * once share one download rather than racing to write the same path. */
const mounts = new Map();

function mountData(pyodide, course, unit, files = []) {
  const at = `/ice-data/${unit}`;
  if (!files.length) return Promise.resolve('');
  if (!mounts.has(at)) {
    mounts.set(at, (async () => {
      pyodide.FS.mkdirTree(at);
      await Promise.all(files.map(async name => {
        const url = `${dataBase(course)}${encodeURIComponent(unit)}/${encodeURIComponent(name)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
        pyodide.FS.writeFile(`${at}/${name}`, new Uint8Array(await r.arrayBuffer()));
      }));
      return at;
    })());
  }
  return mounts.get(at);
}

/** `2.6.1` -> `2.6`. The numbering is the hierarchy, so the unit never needs storing. */
export const unitOf = topic => String(topic).split('.').slice(0, 2).join('.');

/**
 * Grade one submission against its step's SCT.
 *
 * Returns what `python.js` returns - { correct, message, output, error } - where `message`
 * is DataCamp's own feedback and `output` is whatever the submission printed, which the
 * student wants to see whether or not they got it right.
 */
export async function gradePython(course, exercise, step, submission) {
  const unit = unitOf(exercise.topicId || exercise.topic);
  // The grader first, then the mount: the data goes into THAT interpreter's filesystem, and
  // building a new one wipes what the last had mounted.
  const g = await graderFor(exercise);
  const cwd = await mountData(g.pyodide, course, unit, exercise.data || []);
  return g.grade({ pec: exercise.setup, solution: step.solution, submission,
                   sct: step.sct, cwd, seed: seedFor(exercise) });
}

/**
 * Run a submission without grading it, so the student can see what it prints.
 *
 * Deliberately the same execution path as grading rather than a second one: it goes through
 * the grader with the submission as BOTH sides, so what the student sees printed is what
 * the SCT will be looking at. A separate `runPython` would drift from it.
 */
export async function runPython(course, exercise, step, submission) {
  const r = await gradePython(course, exercise, { ...step, solution: submission }, submission);
  return { output: r.output, error: r.error };
}

/** Whether the interpreter has already been paid for, so the UI can say so honestly. */
export const pythonReady = () => !!grader;
