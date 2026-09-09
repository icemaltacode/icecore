/* The Python interpreter the player grades against, and the data it reads.
 *
 * The same job `db.js` does for SQL, and the same shape: something expensive is built once
 * and shared, and everything downstream of it is keyed by what it was built from. What
 * differs is where the cost sits. PGlite is cheap to boot and expensive to seed, so `db.js`
 * caches seeded data directories. Pyodide is the other way round: booting the interpreter
 * and importing pandas is seconds, and every check after that is milliseconds in the same
 * interpreter. So there is exactly one interpreter per session and it is never rebuilt.
 *
 * WHERE PYODIDE COMES FROM: our own origin, and nowhere else. The loader is bundled and the
 * wasm, the stdlib and every package are staged out of node_modules into `pyodide/<version>/`
 * - see src/pyodide-dist.mjs and `pyodideIndexUrl` in wheels.js.
 *
 * This used to be jsDelivr, which is what DataCamp's own player does - campus.datacamp.com
 * loads cdn.jsdelivr.net/pyodide/.../pyodide.js - and it was fine until a class turned out to
 * be behind a network that blocks CDNs. Then the interpreter simply never arrives and every
 * coding exercise in the course is broken for that student and for nobody else.
 *
 * The grader itself was always ours: pythonwhat is unmaintained - 2.30.1, and DataCamp does
 * not appear to load it in the browser at all - so nothing keeps it alive on PyPI. It is a
 * vendored wheel under `app/py/`, installed through micropip's `emfs:` scheme. So the whole
 * of Python now comes from one host, which is the property that was actually wanted.
 */
import { loadPyodide } from 'pyodide';
import { createGrader, seedFor, packageKey } from './python.js';
import { dataBase } from './content.js';
// Shared with the Playground's interpreter - see wheels.js.
import { readWheel, pyodideOptions } from './wheels.js';




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
    const pyodide = await loadPyodide(pyodideOptions());
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
 * Published per MODULE rather than per topic because that is how they exist: a DataCamp
 * course's loose files are shared across all its chapters, and module 4's casts.p is 8.6MB.
 * Fetched lazily - a student doing module 1 never pays for module 4's pickles - and cached
 * by the promise, so two exercises starting at once share one download rather than racing
 * to write the same path.
 *
 * CACHED PER FILE, NOT PER DIRECTORY, and the difference was a bug that only appeared in the
 * right order. The cache was keyed on `/ice-data/<module>`, but the file SET is a property of
 * the exercise: 1.1.2's "Subsetting" declares baseball.csv and "2D Arithmetic", the very next
 * one, declares baseball.csv AND update.csv. Opening them in that order found the directory
 * already mounted, returned the first exercise's promise, and never fetched update.csv at
 * all - `FileNotFoundError: 'update.csv'` on a file that was sitting in the bucket. Open the
 * second one first and it worked, which is exactly the kind of fault that survives testing.
 *
 * A FAILURE IS NOT REMEMBERED. A rejected promise left in the map is a file that can never be
 * fetched again for the life of the interpreter, so one dropped request would break an
 * exercise until the tab was reloaded. */
const mounts = new Map();

function mountData(pyodide, course, mod, files = []) {
  const at = `/ice-data/${mod}`;
  if (!files.length) return Promise.resolve('');
  pyodide.FS.mkdirTree(at);
  const each = files.map(name => {
    const path = `${at}/${name}`;
    if (!mounts.has(path)) {
      mounts.set(path, (async () => {
        const url = `${dataBase(course)}${encodeURIComponent(mod)}/${encodeURIComponent(name)}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
        pyodide.FS.writeFile(path, new Uint8Array(await r.arrayBuffer()));
      })().catch(e => { mounts.delete(path); throw e; }));
    }
    return mounts.get(path);
  });
  return Promise.all(each).then(() => at);
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
  /* READ FROM WHERE THE RUN ACTUALLY HAPPENED, which is not always the directory handed to
   * it. An exercise with no `data:` mounts nothing, so `cwd` is the empty string and the run
   * takes place in the interpreter's own home - and joining a filename onto '' reads from
   * the filesystem ROOT, finds nothing, and drops the file. The student pressed Run, saw the
   * output, and was offered no workbook. See `_ice_run` in python.js. */
  return { ...r, files: readFiles(g.pyodide, r.cwd || cwd, r.files) };
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
