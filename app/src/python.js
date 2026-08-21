/* Grading a Python exercise, by running DataCamp's own grader.
 *
 * A module 2 exercise carries an SCT - a Submission Correctness Test - which is a
 * `pythonwhat` program, not a description of one:
 *
 *     Ex().has_import("seaborn")
 *     Ex().check_function("seaborn.scatterplot").multi(
 *         check_args("x").has_equal_ast(),
 *         check_args("y").has_equal_ast())
 *
 * So we execute it rather than interpret it. `pythonwhat` is on PyPI, pure Python, and runs
 * under Pyodide; the alternative was reimplementing `has_equal_ast`, `check_args` and
 * thirty-five other functions and owning DataCamp's edge cases forever. Measured across
 * module 2: 551 gradeable units, 37 distinct pythonwhat functions, none of them custom.
 *
 * WHY THIS IS NOT LIKE SQL GRADING. A result set is compared against values precomputed at
 * build time, because booting PGlite costs seconds per check. Here the interpreter is
 * already up and a check costs ~20ms, so grading is live and there is nothing to
 * precompute. What the builder does instead is *validate*: every reference solution is
 * graded against its own SCT, and a solution that does not mark itself correct fails the
 * build. Same job `verify` does for SQL, different mechanism.
 *
 * WHY THE PYODIDE INSTANCE IS INJECTED. This module has to run in the browser and in Node -
 * the player grades a submission, the builder validates a solution, and the two must agree
 * about what "correct" means. Keeping it free of imports is what lets the builder use it,
 * exactly as `compare.js` and `dragdrop.js` are shared. The caller brings Pyodide and a way
 * to read a wheel; everything here is the part that must not differ.
 */

/* The grader itself, in dependency order. Vendored under `app/public/py/` and installed
 * from there rather than fetched from PyPI at runtime: `/content/*` sits behind the
 * CloudFront key group, and a player that reaches out to pypi.org mid-exercise is both a
 * new failure mode and a new thing to trust.
 *
 * markdown2 is FIRST and pinned exactly because pythonwhat requires `markdown2==2.5.3`. Let
 * micropip resolve on its own and it fetches the current release, then fails its own pin
 * with "Requested markdown2==2.5.3, but markdown2==2.5.5 is already installed".
 *
 * asttokens, jinja2, markupsafe and six are pythonwhat dependencies and are NOT here:
 * Pyodide bundles all four, and micropip resolves those before looking anywhere else. */
export const GRADER_WHEELS = [
  'markdown2-2.5.3-py3-none-any.whl',
  'dill-0.4.1-py3-none-any.whl',
  'protowhat-2.3.1-py3-none-any.whl',
  'pythonwhat-2.30.1-py3-none-any.whl',
];

/* Packages a unit needs that Pyodide does not bundle. `packages` on a unit names things
 * `loadPackage` can fetch; these have to come from a wheel. Both are pure Python.
 * numpy, pandas, matplotlib, scipy and statsmodels are all bundled and go in `packages`. */
export const WHEELS_BY_NAME = {
  seaborn: 'seaborn-0.13.2-py3-none-any.whl',
  pingouin: 'pingouin-0.6.1-py3-none-any.whl',
};

/* The bridge, defined once per interpreter rather than per check.
 *
 * `mode="stub"` is the only mode that works under WASM. The default, `"simple"`, builds a
 * `multiprocessing.Process`, and Pyodide has no `_multiprocessing` - it fails with
 * ModuleNotFoundError before grading anything. "stub" runs the code with plain `exec` in a
 * namespace dict. pythonwhat's own source calls that "no isolation", and it means what it
 * says: the submission executes in the same interpreter as the grader. That is the same
 * trust model as the SQL editor - a student's own browser, running their own answer,
 * against a formative exercise - and it would NOT be good enough for a summative mark.
 *
 * `run_exercise` returns four values and the SOLUTION process comes first, which is the
 * reverse of the order `test_exercise` names its parameters in. Getting that backwards
 * grades the student's submission against itself and passes everything. */
const BRIDGE = `
from pythonwhat.local import run_exercise
from pythonwhat.test_exercise import test_exercise

def _ice_grade(pec, sol, stu, sct):
    sol_p, stu_p, raw, err = run_exercise(pec, sol, stu, mode="stub")
    result = test_exercise(
        sct=sct, student_code=stu, solution_code=sol, pre_exercise_code=pec,
        student_process=stu_p, solution_process=sol_p, raw_student_output=raw,
        ex_type="NormalExercise", error=err)
    return {
        "correct": bool(result.get("correct")),
        "message": result.get("message") or "",
        "output": raw or "",
        "error": err or "",
    }
`;

/* Plots are rendered to a memory buffer rather than to a canvas. Nothing in module 2's 551
 * units asserts on a figure - DataCamp's own SCTs check that you CALLED scatterplot with
 * the right arguments, never what came out - so grading never needs a real backend, and
 * asking for one inside a worker is how matplotlib hangs. Showing a student their own plot
 * is a separate job from grading it. */
const HEADLESS = 'import matplotlib\nmatplotlib.use("Agg")\n';

/**
 * Prepare an interpreter to grade one unit's exercises, and return something that can.
 *
 * `pyodide`   a booted Pyodide instance, from the caller's own import
 * `readWheel` name -> bytes; `fetch` in the browser, `fs.readFile` in Node
 * `packages`  Pyodide-bundled distribution names, e.g. ['pandas', 'matplotlib']
 * `wheels`    names from WHEELS_BY_NAME, e.g. ['seaborn']
 *
 * Reused across every exercise in the unit: the first grade costs ~1.9s because it is
 * importing seaborn and matplotlib into the namespace, and every one after it is ~20ms in
 * the same interpreter. Building a fresh grader per exercise would pay that 1.9s each time
 * and turn a live check into a slow one.
 */
export async function createGrader({ pyodide, readWheel, packages = [], wheels = [] }) {
  await pyodide.loadPackage(['micropip', ...packages]);

  /* Wheels go through the in-memory filesystem and are installed with micropip's `emfs:`
   * scheme. The alternative - handing micropip an http URL - works in the browser and not
   * in Node, and the whole point of this module is that both do the same thing. */
  const micropip = pyodide.pyimport('micropip');
  const dir = '/ice-wheels';
  try { pyodide.FS.mkdir(dir); } catch { /* already there on a second grader */ }
  const names = [...GRADER_WHEELS, ...wheels.map(w => WHEELS_BY_NAME[w]).filter(Boolean)];
  for (const name of names)
    pyodide.FS.writeFile(`${dir}/${name}`, await readWheel(name));
  // One at a time, in order: micropip resolves each call independently, and markdown2 has
  // to be pinned before pythonwhat asks for it.
  for (const name of names) await micropip.install([`emfs:${dir}/${name}`]);

  if (packages.includes('matplotlib')) pyodide.runPython(HEADLESS);
  pyodide.runPython(BRIDGE);
  const call = pyodide.globals.get('_ice_grade');

  return {
    /**
     * Grade one submission. Returns { correct, message, output, error }.
     *
     * `message` is DataCamp's own feedback, HTML and all - "Did you correctly specify the
     * argument x?" - which is worth far more to a student than anything we would write, and
     * is the second reason for running their grader rather than writing one.
     */
    async grade({ pec = '', solution, submission, sct }) {
      const result = call(pec, solution, submission, sct);
      try {
        return result.toJs({ dict_converter: Object.fromEntries });
      } finally {
        result.destroy?.();
      }
    },
  };
}
