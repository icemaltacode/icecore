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
import { createGrader, WHEELS_BY_NAME, seedFor } from './python.js';
import { dataBase } from './content.js';

const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

/* The wheels, as build assets rather than as files under `public/`.
 *
 * `icecore dev` points Vite's publicDir at the COURSE's staging directory, so the app's own
 * public/ is not served at all - a fetch for /py/pythonwhat.whl returned the app's index
 * page, and micropip reported "File is not a zip file" with nothing pointing at the cause.
 * Imported as assets instead: Vite resolves them in dev and emits them with a content hash
 * in a build, and neither depends on publicDir.
 *
 * Globbed rather than listed one by one so adding a wheel is a file, not an edit here and
 * an edit in python.js. */
const WHEEL_URLS = Object.fromEntries(
  Object.entries(import.meta.glob('../py/*.whl', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.split('/').pop(), url]));

const wheelUrl = name => WHEEL_URLS[name]
  || (() => { throw new Error(`the Python grader is missing ${name}`); })();

let booting = null;
function interpreter() {
  if (!booting) booting = loadPyodide({ indexURL: INDEX_URL });
  return booting;
}

/* One grader, grown as the course needs it.
 *
 * A student walking through a unit meets exercises wanting different packages, and
 * `loadPackage` is incremental and free on a second call - so rather than a grader per
 * package-set, there is one grader and each exercise tops up what it needs. Rebuilding it
 * per exercise would pay the ~2s import cost again every time.
 *
 * The wheels only ever install once: `createGrader` is what installs them, so it runs on
 * the first Python exercise of the session and never again. */
let grader = null;
const loaded = new Set();

async function graderFor(packages = [], wheels = []) {
  const pyodide = await interpreter();
  if (!grader) {
    grader = await createGrader({
      pyodide, packages, wheels,
      readWheel: async name => {
        const r = await fetch(wheelUrl(name));
        if (!r.ok) throw new Error(`cannot load the Python grader (${name}: ${r.status})`);
        return new Uint8Array(await r.arrayBuffer());
      },
    });
    for (const p of [...packages, ...wheels]) loaded.add(p);
    return grader;
  }
  // Anything this exercise wants that an earlier one did not.
  const missing = packages.filter(p => !loaded.has(p));
  if (missing.length) { await pyodide.loadPackage(missing); missing.forEach(p => loaded.add(p)); }
  const extraWheels = wheels.filter(w => !loaded.has(w) && WHEELS_BY_NAME[w]);
  if (extraWheels.length) {
    const micropip = pyodide.pyimport('micropip');
    for (const w of extraWheels) {
      const name = WHEELS_BY_NAME[w];
      pyodide.FS.writeFile(`/ice-wheels/${name}`,
        new Uint8Array(await (await fetch(wheelUrl(name))).arrayBuffer()));
      await micropip.install([`emfs:/ice-wheels/${name}`]);
      loaded.add(w);
    }
  }
  return grader;
}

/* A unit's data files, fetched once and written into the interpreter's filesystem.
 *
 * Keyed by unit rather than by topic because that is how they are published: the files are
 * shared inside a unit, and 2.4's casts.p is 8.6MB. Fetched lazily - a student doing 2.1
 * never pays for 2.4's pickles - and cached by the promise, so two exercises starting at
 * once share one download rather than racing to write the same path. */
const mounts = new Map();

function mountData(course, unit, files = []) {
  const at = `/ice-data/${unit}`;
  if (!files.length) return Promise.resolve('');
  if (!mounts.has(at)) {
    mounts.set(at, (async () => {
      const pyodide = await interpreter();
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
  const [g, cwd] = await Promise.all([
    graderFor(exercise.packages || [], exercise.wheels || []),
    mountData(course, unit, exercise.data || []),
  ]);
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
