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

/* A module's data files, fetched once and written into the interpreter's filesystem.
 *
 * Keyed by MODULE rather than by topic because that is how they are published: a DataCamp
 * course's loose files are shared across all its chapters, and module 4's casts.p is 8.6MB.
 * Fetched lazily - a student doing module 1 never pays for module 4's pickles - and cached
 * by the promise, so two exercises starting at once share one download rather than racing
 * to write the same path. */
const mounts = new Map();

function mountData(pyodide, course, mod, files = []) {
  const at = `/ice-data/${mod}`;
  if (!files.length) return Promise.resolve('');
  if (!mounts.has(at)) {
    mounts.set(at, (async () => {
      pyodide.FS.mkdirTree(at);
      await Promise.all(files.map(async name => {
        const url = `${dataBase(course)}${encodeURIComponent(mod)}/${encodeURIComponent(name)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
        pyodide.FS.writeFile(`${at}/${name}`, new Uint8Array(await r.arrayBuffer()));
      }));
      return at;
    })());
  }
  return mounts.get(at);
}

/* `6.1.2` -> `module-6`. The numbering is the hierarchy, so the module never needs storing.
 * The `module-` prefix is part of the published path, not decoration: `data/` holds SQL
 * datasets and Python data directories side by side and the name is what tells them apart -
 * see the note on PY_DIR in build.mjs. */
export const moduleDataDir = topic => `module-${String(topic).split('.')[0]}`;

/**
 * Grade one submission against its step's SCT.
 *
 * Returns what `python.js` returns - { correct, message, output, error } - where `message`
 * is DataCamp's own feedback and `output` is whatever the submission printed, which the
 * student wants to see whether or not they got it right.
 */
export async function gradePython(course, exercise, step, submission) {
  const mod = moduleDataDir(exercise.topicId || exercise.topic);
  // The grader first, then the mount: the data goes into THAT interpreter's filesystem, and
  // building a new one wipes what the last had mounted.
  const g = await graderFor(exercise);
  const cwd = await mountData(g.pyodide, course, mod, exercise.data || []);
  return g.grade({ pec: exercise.setup, solution: step.solution, submission,
                   sct: step.sct, cwd, seed: seedFor(exercise), capture: true });
}

/**
 * Run a submission without grading it, so the student can see what it did.
 *
 * Returns { output, error, figures, files }, where a file carries its own bytes.
 *
 * This used to go through `gradePython` with the submission as both sides, so that what the
 * student saw printed was what the SCT would look at. It is now the grader's own `run`,
 * which reaches pythonwhat's `run_single_process` in the same stub mode and the same
 * working directory that grading uses - the same guarantee, without executing the student's
 * code twice. Twice was not merely wasteful: whatever the first run wrote was already on
 * disk when the second wrote it, so a file the student had plainly just created looked
 * unchanged and was never offered to them.
 */
export async function runPython(course, exercise, step, submission) {
  const mod = moduleDataDir(exercise.topicId || exercise.topic);
  const g = await graderFor(exercise);
  const cwd = await mountData(g.pyodide, course, mod, exercise.data || []);
  const r = await g.run({ pec: exercise.setup, submission, cwd, seed: seedFor(exercise) });
  return { ...r, files: readFiles(g.pyodide, cwd, r.files) };
}

/* The bytes of each file the run wrote. Read here rather than base64'd through the bridge:
 * a workbook is a quarter of a megabyte and the interpreter's filesystem is right there.
 * A file that vanishes between being named and being read is skipped rather than fatal -
 * nothing else in the run is worth losing over it. */
function readFiles(pyodide, cwd, names = []) {
  const out = [];
  for (const name of names) {
    try {
      out.push({ name, bytes: pyodide.FS.readFile(`${cwd}/${name}`) });
    } catch { /* gone, or not a plain file after all */ }
  }
  return out;
}

/** Whether the interpreter has already been paid for, so the UI can say so honestly. */
export const pythonReady = () => !!grader;
