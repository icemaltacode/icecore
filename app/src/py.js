/* The Python interpreter the player grades against, and the data it reads.
 *
 * The same job `db.js` does for SQL, and the same shape: something expensive is built once
 * and shared, and everything downstream of it is keyed by what it was built from. What
 * differs is where the cost sits. PGlite is cheap to boot and expensive to seed, so the SQL
 * worker caches seeded data directories. Pyodide is the other way round: booting the
 * interpreter and importing pandas is seconds, and every check after that is milliseconds in
 * the same interpreter. So one interpreter serves a whole module, and is rebuilt only when
 * the student crosses into the next.
 *
 * THE INTERPRETER LIVES IN A WORKER (py.worker.js), and this file is the page's half: it
 * decides when an interpreter exists, which packages it holds, and when it is thrown away.
 * See worker-rpc.js for why. Nothing here imports Pyodide.
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
import { ref } from 'vue';
import { seedFor, packageKey } from './python.js';
import { dataBase } from './content.js';
import { spawn } from './worker-rpc.js';

/* One grader, rebuilt when the exercise needs a different set of packages.
 *
 * NOT grown here, and never by anything but the builder. A package that is merely
 * importable changes behaviour: pandas takes a different factorize path when pyarrow is
 * present, and on a pickle-loaded frame that path raises "putmask: output array is
 * read-only" from inside pandas, naming nothing you could search for. Module 4 never asks
 * for pyarrow and broke anyway, because module 8 did. See `packageKey` in python.js.
 *
 * The set an exercise arrives with is its whole MODULE's, assigned and validated by the
 * builder (`shareModuleInterpreter` in src/build.mjs), so within a module the key does not
 * change and this rebuilds only when a student crosses into the next one. Topping up here
 * instead would grade in a set the build never checked.
 *
 * Exactly one is alive at a time, and the old one is TERMINATED before the next boots: its
 * worker goes, and its heap with it. Keeping one per package set would avoid the rebuilds
 * and hold tens of megabytes of wasm per entry, which is the wrong trade for something a
 * student crosses at a module boundary.
 */
let grader = null;      // the worker whose interpreter has booted
let graderKey = null;
let booting = null;     // the worker still booting, so a Stop can end that too
let building = null;

/* WHETHER PYTHON IS STARTING RIGHT NOW, for the overlay that covers the editor while it is.
 * On while an interpreter is being built, and while a freshly built one runs its first setup -
 * which is where pandas is imported. Not on for the setup of every later exercise: in an
 * interpreter that already has its imports that takes a few milliseconds, and an editor that
 * locked for a blink on every Next would read as broken. */
export const pythonStarting = ref(false);
let startingFor = 0;
const starting = async fn => {
  startingFor++;
  pythonStarting.value = true;
  try { return await fn(); } finally { if (--startingFor === 0) pythonStarting.value = false; }
};
/* An interpreter built but not yet warmed: its first setup is the expensive one. */
let cold = null;

const makeWorker = () =>
  new Worker(new URL('./py.worker.js', import.meta.url), { type: 'module' });

async function graderFor(exercise) {
  const key = packageKey(exercise);
  if (grader && graderKey === key) return grader;
  // Serialised: two exercises starting at once must not build two interpreters.
  if (building) { await building; return graderFor(exercise); }
  const mine = starting(async () => {
    grader?.stop('Python moved on to a different set of packages.');
    grader = null; graderKey = null; cold = null; hinted = null;
    const w = spawn(makeWorker);
    booting = w;
    try {
      await w.call('boot', { packages: exercise.packages || [], wheels: exercise.wheels || [] });
    } finally { if (booting === w) booting = null; }
    grader = w; graderKey = key;
    cold = w;
    return w;
  });
  building = mine;
  /* ONLY ITS OWN. A Stop during a boot drops `building` so the warm-up that follows starts a
   * new one at once; this finally then runs later, and clearing whatever `building` holds by
   * then would forget that new boot and let a third caller start a duplicate. */
  try { return await mine; } finally { if (building === mine) building = null; }
}

/* `6.1.2` -> `module-6`. The numbering is the hierarchy, so the module never needs storing.
 * The `module-` prefix is part of the published path, not decoration: `data/` holds SQL
 * datasets and Python data directories side by side and the name is what tells them apart -
 * see the note on PY_DIR in build.mjs. */
export const moduleDataDir = topic => `module-${String(topic).split('.')[0]}`;

/* The exercise's data files, mounted in the worker's filesystem; answers the directory, or ''
 * for an exercise with none. The URLs are made ABSOLUTE here, against the page: a relative
 * one would resolve against the worker's script, which lives somewhere else entirely. */
function mount(g, course, exercise) {
  const mod = moduleDataDir(exercise.topicId || exercise.topic);
  const files = (exercise.data || []).map(name => ({
    name,
    url: new URL(`${dataBase(course)}${encodeURIComponent(mod)}/${encodeURIComponent(name)}`,
                 location.href).href,
  }));
  return g.call('mount', { dir: `/ice-data/${mod}`, files });
}

/**
 * Grade one submission against its step's SCT.
 *
 * Returns what `python.js` returns - { correct, message, output, error } - where `message`
 * is DataCamp's own feedback and `output` is whatever the submission printed, which the
 * student wants to see whether or not they got it right.
 */
export async function gradePython(course, exercise, step, submission) {
  // The grader first, then the mount: the data goes into THAT interpreter's filesystem, and
  // building a new one wipes what the last had mounted.
  const g = await graderFor(exercise);
  if (cold === g) cold = null;   // this grade does the importing; the warm-up will be quick
  const cwd = await mount(g, course, exercise);
  return g.call('grade', { pec: exercise.setup, solution: step.solution, submission,
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
  const g = await graderFor(exercise);
  if (cold === g) cold = null;   // this run does the importing; the warm-up will be quick
  const cwd = await mount(g, course, exercise);
  return g.call('run', { pec: exercise.setup, submission, cwd, seed: seedFor(exercise) });
}

/** Whether the interpreter has already been paid for, so the UI can say so honestly. */
export const pythonReady = () => !!grader;

/**
 * End whatever Python is doing, now - a `while True:` included, which nothing else can.
 *
 * The interpreter goes with it, so the next Run or Check boots a fresh one. That costs
 * seconds, which is why the caller warms the exercise again straight away rather than
 * leaving the student to discover it on their next press. A Run or Check in flight rejects
 * with `message`, marked `stopped`.
 */
export function stopPython(message = 'Stopped.') {
  for (const w of [grader, booting]) w?.stop(message);
  grader = null; graderKey = null; booting = null; cold = null; hinted = null;
  // A boot this ended is not one to wait for: whoever asks next starts a new one.
  building = null;
}

/* ---- the editor's completion, from what the setup made -------------------------------
 *
 * WARMED, NEVER WAITED FOR. An exercise asks for this as it opens, and until it has finished
 * `completePython` answers null and the editor offers what it always did. The same work also
 * pays for the interpreter a first Run would otherwise have waited on.
 *
 * ONE EXERCISE AT A TIME, for the interpreter that is alive. A namespace holding the last
 * exercise's DataFrames is memory for names nobody is being offered, and one belonging to an
 * interpreter since replaced would offer names that no longer exist. */
let hinted = null;   // { grader, id } - whose names the editor may be offered

export function warmPython(course, exercise) {
  /* ONE STRETCH OF "STARTING", start to finish, whenever this interpreter is not already
   * warm - so the overlay over the editor goes up once and comes down once, rather than
   * dropping between building the interpreter and running its first setup. Set
   * synchronously, before anything is awaited, so the exercise's first paint already shows
   * it. A warm interpreter's setup takes milliseconds and shows nothing. */
  const warm = grader && graderKey === packageKey(exercise) && cold !== grader;
  const work = async () => {
    const g = await graderFor(exercise);
    const cwd = await mount(g, course, exercise);
    if (cold === g) cold = null;
    await g.call('hints', { pec: exercise.setup || '', cwd });
    if (g === grader) hinted = { grader: g, id: exercise.id };
  };
  return warm ? work() : starting(work);
}

/** Where `code` stops being Python - `[line, col, endLine, endCol, message]` - or null when it
 *  compiles or there is no interpreter yet. Any interpreter will do: parsing does not depend
 *  on which packages it holds. */
export async function checkPython(code) {
  if (!grader) return null;
  return grader.call('syntax', { code }).catch(() => null);
}

/** `[label, type, detail]` for what may follow the caret, or null while not warmed yet. */
export async function completePython(exercise, kind, base, prefix) {
  if (!hinted || hinted.grader !== grader || hinted.id !== exercise.id) return null;
  return grader.call('complete', { kind, base, prefix }).catch(() => null);
}
