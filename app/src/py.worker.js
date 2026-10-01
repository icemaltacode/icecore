/* An exercise's Python interpreter, in a worker of its own.
 *
 * py.js decides WHEN an interpreter exists and which packages it holds; this file only does
 * what it is asked. See worker-rpc.js for why a worker at all.
 *
 * ONE INTERPRETER PER WORKER, FOR THE WORKER'S WHOLE LIFE. A different package set is a
 * different worker: py.js terminates this one and makes another. So nothing here ever asks
 * whether the interpreter it holds is still the right one, and the old one's heap goes back
 * the moment it is replaced, rather than whenever the garbage collector got round to it.
 */
import { loadPyodide } from 'pyodide';
import { createGrader } from './python.js';
// Shared with the Playground's interpreter - see wheels.js.
import { readWheel, pyodideOptions } from './wheels.js';
import { serve, moving } from './worker-rpc.js';

let grader = null;

const need = () => {
  if (!grader) throw new Error('Python has not started yet.');
  return grader;
};

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
 * exercise until the tab was reloaded.
 *
 * The cache lives here, beside the filesystem it describes: a new worker has an empty
 * filesystem and an empty cache, and the two cannot disagree. */
const mounts = new Map();

function mountData(pyodide, dir, files) {
  if (!files.length) return Promise.resolve('');
  pyodide.FS.mkdirTree(dir);
  const each = files.map(({ name, url }) => {
    const path = `${dir}/${name}`;
    if (!mounts.has(path)) {
      mounts.set(path, (async () => {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`cannot load ${name} (${r.status})`);
        pyodide.FS.writeFile(path, new Uint8Array(await r.arrayBuffer()));
      })().catch(e => { mounts.delete(path); throw e; }));
    }
    return mounts.get(path);
  });
  return Promise.all(each).then(() => dir);
}

/* The bytes of each file a run wrote. Read here rather than base64'd through the bridge: a
 * workbook is a quarter of a megabyte and the interpreter's filesystem is right here. They
 * are MOVED to the page, not copied. A file that vanishes between being named and being
 * read is skipped rather than fatal - nothing else in the run is worth losing over it. */
function readFiles(pyodide, cwd, names = []) {
  const out = [];
  for (const name of names) {
    try {
      out.push({ name, bytes: pyodide.FS.readFile(`${cwd}/${name}`) });
    } catch { /* gone, or not a plain file after all */ }
  }
  return out;
}

serve({
  async boot({ packages = [], wheels = [] }) {
    const pyodide = await loadPyodide(pyodideOptions());
    grader = await createGrader({ pyodide, packages, wheels, readWheel });
    return true;
  },

  /** Mount `files` (`{ name, url }`) under `dir`; answers the directory, or '' for none. */
  mount: ({ dir, files = [] }) => mountData(need().pyodide, dir, files),

  grade: args => need().grade(args),

  async run(args) {
    const g = need();
    const r = await g.run(args);
    /* READ FROM WHERE THE RUN ACTUALLY HAPPENED, which is not always the directory handed to
     * it. An exercise with no `data:` mounts nothing, so `cwd` is the empty string and the run
     * takes place in the interpreter's own home - and joining a filename onto '' reads from
     * the filesystem ROOT, finds nothing, and drops the file. See `_ice_run` in python.js. */
    const files = readFiles(g.pyodide, r.cwd || args.cwd, r.files);
    return moving({ ...r, files }, files.map(f => f.bytes.buffer));
  },

  hints(args) { need().hints(args); return true; },
  complete: ({ kind, base, prefix }) => need().complete(kind, base, prefix),
  syntax: ({ code }) => need().syntax(code),
});
