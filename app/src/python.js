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
/* The seed both runs start from. Any fixed number would do; an exercise can name its own
 * with `seed:` in its frontmatter, and `seed: null` turns it off for one that is genuinely
 * meant to vary - though such an exercise cannot then be graded on values. */
/* AN INTERPRETER MUST HOLD EXACTLY THE SET THE BUILD VALIDATED THE EXERCISE IN, no more.
 *
 * Merely IMPORTABLE packages change behaviour. pandas takes a different factorize path when
 * pyarrow is present, and on a pickle-loaded frame that path writes into a read-only buffer:
 *
 *   licenses.merge(zip_demo, on='zip')
 *   ValueError: putmask: output array is read-only        (pandas/core/reshape/merge.py)
 *
 * Module 4 (unit 2.4 at the time) has no .feather files and never asks for pyarrow. It broke
 * anyway, because the builder loaded the union of every package the COURSE needs into one
 * interpreter and module 8 needs pyarrow. Eleven merges failed pointing at pandas
 * internals, with nothing naming the cause.
 *
 * So a grader is keyed by its exact package set and a different set means a different
 * interpreter. Not "a superset is fine": an unchecked superset is precisely the failure,
 * and "load the union of the course once" is the obvious implementation that produced it.
 * The set an exercise carries is its MODULE's union, assigned by the builder
 * (`shareModuleInterpreter` in src/build.mjs), and that is safe only because the build
 * grades every reference solution in that same set.
 *
 * There is no unloading. Pyodide cannot remove a module from a running interpreter, so the
 * only way back from an extra package is a new one. */
export const packageKey = ({ packages = [], wheels = [] }) =>
  JSON.stringify([[...packages].sort(), [...wheels].sort()]);

export const DEFAULT_SEED = 20260821;

/**
 * The seed an exercise runs under. Shared so the builder validates against exactly what the
 * player will grade against - a different seed either side would let a solution pass the
 * build and fail the student.
 */
export const seedFor = exercise => {
  if (!exercise || !('seed' in exercise)) return DEFAULT_SEED;
  if (/^(none|null|false|off)$/i.test(String(exercise.seed))) return null;
  return Number(exercise.seed) || DEFAULT_SEED;
};

export const GRADER_WHEELS = [
  'markdown2-2.5.3-py3-none-any.whl',
  'dill-0.4.1-py3-none-any.whl',
  'protowhat-2.3.1-py3-none-any.whl',
  'pythonwhat-2.30.1-py3-none-any.whl',
];

/* Packages a unit needs that Pyodide does not bundle. `packages` on a unit names things
 * `loadPackage` can fetch; these have to come from a wheel. All of them are pure Python.
 * numpy, pandas, matplotlib, scipy and statsmodels are all bundled and go in `packages`.
 *
 * KEYED BY MODULE NAME, because the Playground looks a wheel up by what the student tried
 * to import. A value may be a LIST, and then it is in install order with dependencies
 * first: micropip resolves each install independently and would otherwise go to PyPI for
 * the dependency, which is the one bit of network trust vendoring exists to avoid. openpyxl
 * needs et_xmlfile, so asking for openpyxl has to bring both.
 *
 * et_xmlfile is listed on its own as well - not redundant. This map answers two questions:
 * "what does `wheels: [openpyxl]` install" and "a student typed `import et_xmlfile`, what
 * provides that". */
export const WHEELS_BY_NAME = {
  seaborn: 'seaborn-0.13.2-py3-none-any.whl',
  pingouin: 'pingouin-0.6.1-py3-none-any.whl',
  et_xmlfile: 'et_xmlfile-2.0.0-py3-none-any.whl',
  openpyxl: ['et_xmlfile-2.0.0-py3-none-any.whl', 'openpyxl-3.1.5-py2.py3-none-any.whl'],
};

/** The wheel files a list of module names needs, in install order, without repeats. */
export const wheelsFor = names =>
  [...new Set((names || []).flatMap(n => WHEELS_BY_NAME[n] || []))];

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
import base64, io, os, sys
import pythonwhat.utils
from pythonwhat.local import ChDir, run_exercise, run_single_process
from pythonwhat.test_exercise import test_exercise

# pythonwhat pretty-prints code INTO A FEEDBACK MESSAGE with black, and imports it lazily
# so the failure only appears on the paths that build such a message: seven module 2
# exercises died with ModuleNotFoundError: No module named 'black'.
#
# Vendoring it would be five more wheels - black drags in click, pathspec, platformdirs and
# mypy_extensions - for reformatting a snippet in a sentence. The function it backs already
# falls back to the unformatted text when black raises, so this is that fallback with the
# import removed. The student sees their own code as they typed it, which is arguably the
# better version of the message anyway.
pythonwhat.utils.format_code = lambda text: text

# SEEDED, and it has to be.
#
# pythonwhat runs the solution and the submission in SEPARATE interpreters and compares what
# each produced. Unseeded, \`np.random.normal(size=5)\` gives two different answers and the
# REFERENCE SOLUTION FAILS AGAINST ITSELF:
#
#   Did you correctly define the variable five_rolls?
#   Expected [7 2 6 5 6], but got [3 8 2 6 8]
#
# I had said no marker was needed because nothing is precomputed, which was the wrong
# conclusion from a right premise: nothing goes stale, but the two runs still have to agree
# with each other. Thirteen of module 2's sampling exercises fail on exactly this.
#
# Seeding the same value into both runs makes them agree while leaving the grading honest -
# a submission that draws differently still gets different numbers and is still marked
# wrong. It runs BEFORE the exercise's own setup, so an exercise that seeds deliberately
# overrides this rather than fighting it.
_ICE_SEED = '''
import random as _ice_random
_ice_random.seed({seed})
try:
    import numpy as _ice_numpy
    _ice_numpy.random.seed({seed})
except ImportError:
    pass
'''

# ---- artefacts: what the run drew, and what it wrote -------------------------
#
# WHY A PROLOGUE RATHER THAN A SNAPSHOT AROUND run_exercise. Grading runs the SOLUTION
# first and the submission second - see pythonwhat.local.run_exercise - in one interpreter,
# so afterwards matplotlib's figure registry holds both runs' figures with nothing to tell
# them apart. The prologue runs at the head of the setup, which run_single_process executes
# before EACH side, so by the time the submission's own setup has run the solution's
# figures are already closed and everything still open belongs to the student.
#
# It closes rather than merely records: an exercise whose setup does 'fig, ax =
# plt.subplots()' and asks the student to draw into ax must still show that figure, so the
# baseline has to be empty at the point the setup starts rather than after it.
#
# The setup is exec'd in a namespace of its own, so it reaches back through __main__ - the
# module this bridge is running in - rather than calling a name it cannot see.
_ICE_PROLOGUE = '''
import __main__ as _ice_main
_ice_main._ice_before()
'''

# A file a student wrote is worth at most a download button, so the caps are deliberately
# mean: enough for a spreadsheet or a couple of figures, not enough to wedge a tab.
_ICE_MAX_FILES = 8
_ICE_MAX_BYTES = 25 * 1024 * 1024

_ice_seen = {}

def _ice_before():
    """Head of the setup: drop the previous run's figures and note what is on disk."""
    if "matplotlib" in sys.modules:
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except Exception:
            pass
    _ice_seen.clear()
    _ice_seen.update(_ice_listing(os.getcwd()))

def _ice_listing(wd):
    """Every plain file in wd, as name -> (size, mtime). Cheap enough to do twice a run."""
    out = {}
    try:
        entries = os.listdir(wd)
    except OSError:
        return out
    for name in entries:
        try:
            st = os.stat(os.path.join(wd, name))
        except OSError:
            continue
        import stat as _ice_stat
        if _ice_stat.S_ISREG(st.st_mode):
            out[name] = (st.st_size, st.st_mtime)
    return out

def _ice_figures():
    """Whatever the run drew, as base64 PNGs.

    The backend is Agg, so a figure exists in memory and plt.show() did nothing at all -
    which is why an exercise that plots looks, without this, like an exercise that does
    nothing. Rendered at the end rather than at show() time: an exercise may draw over the
    same figure several times and only the last state is worth seeing."""
    if "matplotlib" not in sys.modules:
        return []
    out = []
    try:
        import matplotlib.pyplot as plt
        for n in plt.get_fignums():
            buf = io.BytesIO()
            try:
                plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            except Exception:
                continue
            out.append(base64.b64encode(buf.getvalue()).decode())
        plt.close("all")
    except Exception:
        pass
    return out

def _ice_written(wd):
    """Names of the files the run created or changed, against the prologue's listing.

    Names only: the caller reads the bytes out of the interpreter's filesystem itself,
    rather than paying to base64 a spreadsheet through the bridge and back."""
    out = []
    for name, stamp in sorted(_ice_listing(wd).items()):
        if _ice_seen.get(name) == stamp:
            continue
        if stamp[0] > _ICE_MAX_BYTES:
            continue
        out.append(name)
        if len(out) >= _ICE_MAX_FILES:
            break
    return out

def _ice_run(pec, code, cwd, seed):
    """Run a submission and report what happened - no solution, no SCT.

    The Run button, which used to grade the submission against itself and throw the verdict
    away. That ran the student's code TWICE, so anything it wrote was already on disk before
    the second run wrote it again, and a file whose content had not changed looked like a
    file nobody had written. It goes through pythonwhat's own run_single_process, in the
    same stub mode and the same working directory as grading, so the two cannot drift about
    what running a submission means."""
    wd = cwd or os.getcwd()
    setup = _ice_setup(pec, seed)
    with ChDir(wd):
        _, raw, err = run_single_process(setup, code, mode="stub")
        # cwd is where the run ACTUALLY happened, which is not always what was passed in:
        # an exercise with no data files mounts nothing and is given the empty string, and
        # the run then happens in the interpreter's own home. The caller reads the bytes of
        # these files out of the filesystem itself, so it has to be told which directory to
        # read them from - joining names onto the empty string it passed in reads from the
        # root, finds nothing, and quietly offers the student no file at all.
        #
        # (No backticks in here. This whole block is a JS template literal - see the top of
        # the file - and one would end the string somewhere else entirely.)
        return {"output": raw or "", "error": err or "", "cwd": wd,
                "figures": _ice_figures(), "files": _ice_written(wd)}

def _ice_setup(pec, seed, capture=True):
    """Seed, then the prologue, then the exercise's own setup.

    The prologue is skipped when nothing is being collected, so the builder - which grades
    every reference solution against its own SCT and wants no artefacts at all - runs the
    exact code it ran before any of this existed. A cached verdict has to keep meaning what
    it meant."""
    return ((_ICE_SEED.format(seed=int(seed)) if seed is not None else "")
            + (_ICE_PROLOGUE if capture else "")
            + (pec or ""))

def _ice_grade(pec, sol, stu, sct, cwd, seed, capture):
    # Where the exercise's own data files are mounted, so \`pd.read_csv("cars.csv")\` finds
    # one. Passed per call rather than set with a global chdir: one interpreter serves a
    # whole topic, and a process-wide cwd would leave the next exercise reading the last
    # one's data - which grades against the wrong numbers rather than failing.
    wd = cwd or os.getcwd()
    setup = _ice_setup(pec, seed, capture)
    sol_p, stu_p, raw, err = run_exercise(setup, sol, stu, mode="stub", sol_wd=wd, stu_wd=wd)
    result = test_exercise(
        sct=sct, student_code=stu, solution_code=sol, pre_exercise_code=pec,
        student_process=stu_p, solution_process=sol_p, raw_student_output=raw,
        ex_type="NormalExercise", error=err)
    # Figures only, never files. Both runs write to one working directory, and the solution
    # goes first: a submission that writes the same bytes the solution just wrote leaves the
    # file untouched and would be reported as having written nothing. The Run button is the
    # honest place to collect files, and it runs no solution at all.
    return {
        "correct": bool(result.get("correct")),
        "message": result.get("message") or "",
        "output": raw or "",
        "error": err or "",
        "figures": _ice_figures() if capture else [],
    }

# ---- completion: the names the setup made -----------------------------------
#
# Students start an exercise with homelessness already defined and pandas already imported,
# and the editor could only offer what they had typed themselves. So the setup is run a
# second time, into a namespace of its OWN - never the one a Run or a Check uses - and the
# editor asks it what exists.
#
# NOTHING HERE PARSES WHAT WAS TYPED. The JavaScript side has already worked out whether the
# caret is after a dot, inside a subscript's quotes or on a bare name, and asks one of three
# plain questions. A regex written here would live inside a JavaScript template literal,
# where a backslash is an escape before Python ever sees it.
#
# NOTHING HERE RUNS AN ATTRIBUTE TO NAME IT. getattr on every name a DataFrame lists would
# transpose it for .T, build a Styler for .style and raise for .dt - so a name is classified
# statically, by what it is on the class, and a column is anything the class does not know.

_ice_hint_ns = None

def _ice_hints(pec, cwd):
    """Run the setup into a fresh namespace for the editor to complete from."""
    global _ice_hint_ns
    import io, contextlib
    ns = {"__name__": "__ice_hints__"}
    try:
        quiet = io.StringIO()
        with ChDir(cwd or os.getcwd()):
            with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                exec(pec or "", ns)
    except BaseException:
        # A setup that stops half way still defined what came before it, which is still
        # worth offering.
        pass
    _ice_hint_ns = ns
    return True

def _ice_kind(value):
    import inspect
    if inspect.ismodule(value):
        return "namespace"
    if inspect.isclass(value):
        return "class"
    if isinstance(value, (staticmethod, classmethod)) or inspect.isroutine(value):
        return "function"
    if isinstance(value, property) or inspect.isdatadescriptor(value):
        return "property"
    return "variable"

def _ice_lookup(ns, path):
    import inspect
    parts = path.split(".")
    if parts[0] not in ns:
        raise KeyError(parts[0])
    obj = ns[parts[0]]
    for part in parts[1:]:
        found = inspect.getattr_static(obj, part)
        # A module attribute or an instance's own value is the thing itself; a property on
        # the class would have to be run to get one, and is not.
        if _ice_kind(found) == "property":
            raise AttributeError(part)
        obj = found
    return obj

def _ice_syntax(code):
    """Where the code stops being Python, WITHOUT RUNNING ANY OF IT.

    compile() parses and compiles and executes nothing, and it is the same parser a Run goes
    through - so the message and the position are the ones the student would get on Run.
    [line, col, end_line, end_col, message], 1-based, or None when it compiles. Warnings
    (an invalid escape, say) are not errors and are not reported."""
    import warnings
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            compile(code, "<your code>", "exec", dont_inherit=True)
    except SyntaxError as e:
        line = e.lineno or 1
        col = e.offset or 1
        end_line = getattr(e, "end_lineno", None) or line
        end_col = getattr(e, "end_offset", None) or 0
        return [line, col, end_line, end_col, e.msg or "invalid syntax"]
    except (ValueError, OverflowError) as e:
        return [1, 1, 1, 0, str(e)]
    return None

def _ice_complete(kind, base, prefix):
    """[label, type, detail] for what may follow, or None until the setup has run."""
    import inspect
    ns = _ice_hint_ns
    if ns is None:
        return None
    out = []
    try:
        if kind == "name":
            for name, value in ns.items():
                if name.startswith("_") or not name.startswith(prefix):
                    continue
                out.append([name, _ice_kind(value), type(value).__name__])
        elif kind == "attr":
            obj = _ice_lookup(ns, base)
            for name in dir(obj):
                if not name.startswith(prefix):
                    continue
                if name.startswith("_") and not prefix.startswith("_"):
                    continue
                missing = object()
                found = inspect.getattr_static(obj, name, missing)
                if found is missing:
                    # Listed by dir() and unknown to the class: a DataFrame's columns.
                    out.append([name, "property", "column"])
                else:
                    k = _ice_kind(found)
                    out.append([name, "method" if k == "function" and not inspect.ismodule(obj)
                                else k, ""])
        elif kind == "key":
            obj = _ice_lookup(ns, base)
            if hasattr(obj, "columns"):
                keys, detail = list(obj.columns), "column"
            elif isinstance(obj, dict):
                keys, detail = list(obj.keys()), "key"
            else:
                keys, detail = [], ""
            out = [[k, "property", detail] for k in keys
                   if isinstance(k, str) and k.startswith(prefix)]
    except Exception:
        return []
    return out[:300]
`;

/* Plots are rendered to a memory buffer rather than to a canvas. Nothing in module 2's 551
 * units asserts on a figure - DataCamp's own SCTs check that you CALLED scatterplot with
 * the right arguments, never what came out - so grading never needs a real backend, and
 * asking for one inside a worker is how matplotlib hangs. Showing a student their own plot
 * is a separate job from grading it. */
const HEADLESS = `
import warnings, matplotlib
matplotlib.use("Agg")
# Every exercise that ends in plt.show() warns that Agg cannot show anything. That is the
# backend doing what we asked, once per graded submission - 551 lines of stderr on a full
# build, and noise a student would see in their own output pane.
warnings.filterwarnings("ignore", message=".*non-interactive.*cannot be shown.*")
`;

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
  const names = [...GRADER_WHEELS, ...wheelsFor(wheels)];
  for (const name of names)
    pyodide.FS.writeFile(`${dir}/${name}`, await readWheel(name));
  // One at a time, in order: micropip resolves each call independently, and markdown2 has
  // to be pinned before pythonwhat asks for it.
  for (const name of names) await micropip.install([`emfs:${dir}/${name}`]);

  if (packages.includes('matplotlib')) pyodide.runPython(HEADLESS);
  pyodide.runPython(BRIDGE);
  const call = pyodide.globals.get('_ice_grade');
  const exec = pyodide.globals.get('_ice_run');
  const hints = pyodide.globals.get('_ice_hints');
  const complete = pyodide.globals.get('_ice_complete');
  const syntax = pyodide.globals.get('_ice_syntax');

  /* Python hands back a proxy; every caller wants a plain object and none wants the leak. */
  const plain = result => {
    try { return result.toJs({ dict_converter: Object.fromEntries }); }
    finally { result.destroy?.(); }
  };

  return {
    /* Exposed so a caller can mount data into THIS interpreter's filesystem. It matters
     * which one: a grader is rebuilt when the package set changes, and the new interpreter
     * starts with an empty FS. */
    pyodide,

    /**
     * Grade one submission. Returns { correct, message, output, error }.
     *
     * `cwd` is the directory the exercise's data files are mounted in, or '' for none.
     *
     * `message` is DataCamp's own feedback, HTML and all - "Did you correctly specify the
     * argument x?" - which is worth far more to a student than anything we would write, and
     * is the second reason for running their grader rather than writing one.
     */
    async grade({ pec = '', solution, submission, sct, cwd = '', seed = DEFAULT_SEED,
                  capture = false }) {
      return plain(call(pec, solution, submission, sct, cwd, seed, capture));
    },

    /**
     * Run a submission without grading it. Returns { output, error, cwd, figures, files }.
     *
     * `figures` are base64 PNGs of whatever the run drew - the Agg backend means plt.show()
     * produced nothing a student could see. `files` are the NAMES of files the run created
     * or changed; the caller reads their bytes out of `pyodide.FS` itself, and `cwd` is the
     * directory to read them from - which is NOT always the one passed in, because an
     * exercise with no data files mounts nothing and runs in the interpreter's home.
     */
    async run({ pec = '', submission, cwd = '', seed = DEFAULT_SEED }) {
      return plain(exec(pec, submission, cwd, seed));
    },

    /**
     * Run the exercise's setup into a namespace of its own, for `complete` to read. Never the
     * namespace a run or a grade uses, so nothing here can change what either of them sees.
     */
    hints({ pec = '', cwd = '' }) { hints(pec, cwd); },

    /**
     * What may follow the caret, as `[label, type, detail]`, or null until `hints` has run.
     * `kind` is 'name' (a bare word), 'attr' (after `base.`) or 'key' (inside `base["`), and
     * the caller has already worked out which - see `_ice_complete`.
     */
    complete(kind, base, prefix) {
      const r = complete(kind, base || '', prefix || '');
      if (r == null) return null;
      try { return r.toJs(); } finally { r.destroy?.(); }
    },

    /**
     * Where `code` stops being Python, as `[line, col, endLine, endCol, message]` (1-based),
     * or null when it compiles. Compiled, never run - see `_ice_syntax`.
     */
    syntax(code) {
      const r = syntax(code);
      if (r == null) return null;
      try { return r.toJs(); } finally { r.destroy?.(); }
    },
  };
}
