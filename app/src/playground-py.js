/* The Playground's Python session: run it and show what happened.
 *
 * WHY THIS IS NOT `py.js`. That module builds a GRADER - it runs pythonwhat against a
 * reference solution and returns a verdict, and it rebuilds its interpreter whenever the
 * package set changes, because a package that is merely importable changes what pandas
 * does. Neither applies here. Nothing is graded, so a student accumulating packages as they
 * go is fine, and rebuilding the interpreter under them would throw away everything they
 * had defined. Different lifetime, different job, different module - the same reasoning
 * that keeps `playground-db.js` out of `db.js`.
 *
 * ONE INTERPRETER PER SESSION, and it is never rebuilt. Booting Pyodide is seconds; every
 * run after that is milliseconds. It is separate from the grader's, so a student who does
 * an exercise and then opens the Playground pays twice - which is the honest cost of two
 * interpreters that must not share state, and only happens if they do both in one tab.
 *
 * WHAT THE RUN RETURNS IS OUTPUT, NOT A VERDICT: whatever was printed, the value of the
 * last expression, any figures, and the traceback if there was one. A traceback is output
 * too - shown in the pane, not raised as a failure.
 */
import { loadPyodide, version } from 'pyodide';
import { WHEELS_BY_NAME } from './python.js';
import { readWheel } from './wheels.js';

const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

/* Where a set's files land, and the interpreter's working directory. A student writes
 * `pd.read_csv('gapminder.csv')` and never sees a unit number or a course id - which is the
 * whole reason the manifest carries a working filename at all. */
const WORKDIR = '/ice-playground';

/* Module name -> the vendored wheel that provides it. Everything else a student is likely
 * to import - pandas, numpy, matplotlib, scipy, statsmodels - is bundled with Pyodide and
 * `loadPackagesFromImports` handles it. These two are not bundled, and they come from our
 * own origin rather than PyPI: same wheels the grader uses, no network trust we have not
 * already taken. */
const WHEEL_FOR = WHEELS_BY_NAME;

/* The filename the runtime below is compiled under. Anything but "<exec>", which is what
 * `eval_code` names the student's code - see `_ice_traceback`. */
const RUNTIME_FILE = '<icecore-playground>';

/* NO BACKTICKS BELOW THIS LINE. It is a JavaScript template literal holding Python, so a
 * backtick in a docstring - the natural way to quote an identifier in prose - ends the
 * string and the file stops parsing somewhere else entirely. Single quotes throughout. */
const RUNTIME = `
import io, os, sys, base64, contextlib, traceback, importlib.util
from pyodide.code import eval_code

# The student's own namespace, kept between runs so a variable defined in one cell is there
# in the next. A plain dict rather than the real globals: Reset has to be able to empty it
# without taking the runtime's own helpers with it.
_ICE_NS = {"__name__": "__main__"}

def _ice_missing(names):
    """Which of these modules cannot currently be imported - i.e. what Pyodide will fetch.

    Asked of the interpreter rather than tracked in JavaScript, because the honest answer
    changes as packages arrive and a stale list means either a spinner for something already
    present or silence while a wheel downloads. Standard-library modules already have a
    spec, so they never appear here."""
    out = []
    for n in names:
        if n in sys.modules:
            continue
        try:
            if importlib.util.find_spec(n) is None:
                out.append(n)
        except Exception:
            out.append(n)
    return out

def _ice_cell(v):
    """One value, as something JavaScript can render."""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        # NaN is missing data, and the grid already knows how to draw missing.
        return None if v != v else v
    try:
        return str(v)
    except Exception:
        return "<unprintable>"

def _ice_wants_index(df):
    """Whether the index carries information, or is just row numbers.

    A CSV read straight off disk has a RangeIndex, and showing it would put a second column
    of 0,1,2 beside the stray unnamed one these files already carry. After a groupby or a
    set_index it is the most important column on screen."""
    try:
        import pandas as pd
        ix = df.index
        return not (isinstance(ix, pd.RangeIndex) and ix.start == 0 and ix.step == 1)
    except Exception:
        return False

_ICE_ROWS = 500

def _ice_frame(df):
    head = df.head(_ICE_ROWS)
    fields, cols = [], []
    if _ice_wants_index(df):
        fields.append(str(df.index.name or "index"))
        cols.append(list(head.index))
    seen = {}
    for i, c in enumerate(head.columns):
        name = str(c)
        # A DataFrame may legitimately have two columns of the same name; the rows are dicts
        # keyed by field, so a duplicate would silently swallow the first one.
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        fields.append(name)
        cols.append(list(head.iloc[:, i]))
    rows = [{f: _ice_cell(col[r]) for f, col in zip(fields, cols)} for r in range(len(head))]
    return {"kind": "frame", "fields": fields, "rows": rows,
            "shape": [int(df.shape[0]), int(df.shape[1])], "shown": len(head)}

def _ice_value(v):
    if v is None:
        return None
    try:
        import pandas as pd
        if isinstance(v, pd.DataFrame):
            return _ice_frame(v)
        if isinstance(v, pd.Series):
            # A Series drawn as a one-column table rather than as repr text, so a value
            # counted with value_counts() lines up with the frame it came from.
            return _ice_frame(v.to_frame(name=v.name if v.name is not None else "value"))
    except Exception:
        pass
    try:
        return {"kind": "text", "text": repr(v)}
    except Exception as e:
        return {"kind": "text", "text": f"<unrepresentable: {e}>"}

def _ice_figures():
    """Whatever the run drew.

    Without this a student's first plot() appears to do nothing at all, which is the worst
    possible first impression for a sandbox. The backend is Agg - set before matplotlib is
    ever imported - so a figure exists in memory and nothing has tried to show it."""
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
        return out
    return out

# What the student's own code is compiled as - 'eval_code''s default. THIS RUNTIME is given
# a different name at install time, deliberately: both compile as "<exec>" otherwise, and a
# traceback filter looking for the student's frames stops on the runtime's own instead.
_ICE_FILE = "<exec>"

def _ice_traceback(t, v, tb):
    """Their traceback, not ours.

    A raw format_exception starts inside '_ice_run' and then inside Pyodide's 'eval_code',
    which is four frames of machinery above the line the student actually wrote - and the
    first thing anyone reads is the top of a traceback. Dropping one frame is not enough:
    the internals continue below it. So skip forward to the first frame that belongs to
    their code. A SyntaxError has no frames of theirs at all, and formatting the exception
    alone is the right answer there rather than showing the compiler's."""
    at = tb
    while at is not None and at.tb_frame.f_code.co_filename != _ICE_FILE:
        at = at.tb_next
    if at is None:
        return "".join(traceback.format_exception_only(t, v))
    return "".join(traceback.format_exception(t, v, at))

def _ice_run(src):
    out = io.StringIO()
    value = None
    err = ""
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            value = eval_code(src, _ICE_NS)
        except SystemExit:
            pass
        except BaseException:
            err = _ice_traceback(*sys.exc_info())
        # INSIDE the redirect, and after the except: rendering a figure is what raises
        # matplotlib's own warnings about the student's arguments, and those belong in their
        # output pane rather than on the browser console. Still collected when the run
        # failed, because the code before the exception may well have drawn something.
        figures = _ice_figures()
    return {"out": out.getvalue(), "error": err,
            "value": _ice_value(value), "figures": figures}

def _ice_reset():
    """As honest a reset as the runtime allows.

    Pyodide cannot unload a module and has no teardown, so a true reset means a new
    interpreter - seconds, and it leaks the old one. What this does instead covers
    everything a student actually did: the namespace goes, the figures close, the mounted
    files are removed by the caller. What survives is imports and any state inside them, so
    a monkeypatched library stays monkeypatched. The UI says so rather than pretending."""
    _ICE_NS.clear()
    _ICE_NS["__name__"] = "__main__"
    # The browser's cached reads go too - the files themselves are about to be unlinked by
    # the caller, so a surviving cache would serve a page of a file that is no longer there.
    _ICE_READ.clear()
    if "matplotlib" in sys.modules:
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except Exception:
            pass

def _ice_none(v):
    """Whether a value handed over from JavaScript means 'nothing was given'.

    JavaScript's null does NOT arrive as None. Pyodide hands it across as a JsNull, which is
    not None and is perfectly truthy - so 'col is None' is False and the int() beside it
    raises, on the single most common path there is: searching every column. 'undefined'
    does arrive as None, so the natural spelling passes in testing and fails in the app.

    Tested the other way round instead: a column index is a number, and anything that is not
    one means all of them. bool is an int subclass and is excluded on purpose."""
    return not isinstance(v, (int, float)) or isinstance(v, bool)

def _ice_match(df, q, col):
    """The rows matching a search, across every column or just one.

    POSITIONAL, never by name. A DataFrame may legitimately carry two columns of the same
    name, and df[name] then hands back a DataFrame rather than a Series - the mask breaks
    with an error about ambiguous truth values, on the one file where it matters. iloc has
    no such ambiguity, and it is why the column selector passes an index rather than a
    label."""
    if not q:
        return df
    which = range(df.shape[1]) if _ice_none(col) else [int(col)]
    mask = None
    for i in which:
        m = df.iloc[:, i].astype(str).str.contains(q, case=False, regex=False, na=False)
        mask = m if mask is None else (mask | m)
    return df if mask is None else df[mask]

_ICE_READ = {}

def _ice_read(name):
    """A mounted file, as a frame, read once and kept.

    Cached because a pager asks for the same file again on every page and every keystroke of
    a search, and re-reading 10,000 rows each time makes the browser feel broken. Only files
    are cached: a frame in the namespace is looked up fresh, because the student may have
    reassigned it since the last page."""
    if name in _ICE_READ:
        return _ICE_READ[name]
    import pandas as pd
    low = name.lower()
    if low.endswith(".feather"):
        df = pd.read_feather(name)
    elif low.endswith(".csv"):
        df = pd.read_csv(name)
    else:
        raise ValueError("no reader for " + name)
    _ICE_READ[name] = df
    return df

def _ice_browse(kind, name, q, col, offset, limit):
    """One page of a frame or a mounted file, with both counts.

    BOTH COUNTS, always: how many rows are in the thing, and how many match what was typed.
    A filtered count on its own is the version of this that misleads - 12 rows reads as a
    small table rather than as a narrow search."""
    df = _ice_read(name) if kind == "file" else _ICE_NS.get(name)
    if df is None or not hasattr(df, "columns"):
        raise ValueError(name + " is not something that can be browsed")
    total = int(df.shape[0])
    sub = _ice_match(df, q, col)
    matched = int(sub.shape[0])
    page = sub.iloc[int(offset):int(offset) + int(limit)]
    # Slicing a RangeIndex leaves 200,201,202 behind, which _ice_frame would then draw as a
    # column - a second set of row numbers beside the pager's own. Dropped unless the index
    # was carrying information before the slice, in which case it is the most important
    # column on screen and stays.
    if not _ice_wants_index(df):
        page = page.reset_index(drop=True)
    out = _ice_frame(page)
    out["total"] = total
    out["matched"] = matched
    out["columns"] = [str(c) for c in df.columns]
    return out

def _ice_shape():
    """The frames and files the session currently holds - names, columns and row counts.

    For the assistant, and derived at ask time rather than tracked: the student's own
    session answers what they actually have, including anything they built themselves,
    which is the difference between helping with 'my_summary' and only knowing about
    'planes.csv'."""
    frames = []
    for name, v in list(_ICE_NS.items()):
        if name.startswith("_"):
            continue
        if hasattr(v, "dtypes") and hasattr(v, "shape") and hasattr(v, "columns"):
            try:
                frames.append({
                    "name": name,
                    "rows": int(v.shape[0]),
                    "columns": [{"name": str(c), "type": str(t)}
                                for c, t in zip(v.columns, v.dtypes)],
                })
            except Exception:
                pass
    try:
        files = sorted(os.listdir("${WORKDIR}"))
    except Exception:
        files = []
    return {"frames": frames, "files": files}
`;

let ready = null;
const mounted = new Set();

/** Has the interpreter been paid for yet, so the UI can say so without causing it. */
export const started = () => ready !== null;

function session() {
  if (!ready) ready = (async () => {
    const pyodide = await loadPyodide({ indexURL: INDEX_URL });
    /* Agg BEFORE matplotlib can possibly be imported. Pyodide's default backend draws to a
     * canvas it expects to find in the page; there is no such canvas here, and figures are
     * collected as PNG bytes instead. An environment variable rather than `matplotlib.use`
     * because the student imports matplotlib whenever they feel like it, and by then a
     * backend has already been chosen. */
    pyodide.runPython(`
import os, warnings
os.environ["MPLBACKEND"] = "Agg"
# plt.show() is ordinary code in a sandbox and Agg cannot show anything. The warning is the
# backend doing exactly what we asked, and it would land in the student's output pane once
# per plot.
warnings.filterwarnings("ignore", message=".*non-interactive.*cannot be shown.*")
`);
    pyodide.FS.mkdirTree(WORKDIR);
    pyodide.runPython(`import os; os.chdir(${JSON.stringify(WORKDIR)})`);
    /* Named, so its frames are distinguishable from the student's. Both default to
     * "<exec>", and `_ice_traceback` tells them apart by filename - unnamed, the very first
     * frame it inspects is `_ice_run`'s own and every traceback keeps its machinery. */
    pyodide.runPython(RUNTIME, { filename: RUNTIME_FILE });
    return pyodide;
  })();
  return ready;
}

/** Boot the interpreter, or wait for the boot already in flight. */
export const interpreter = () => session();

const toJs = proxy => {
  try { return proxy.toJs({ dict_converter: Object.fromEntries }); }
  finally { proxy.destroy?.(); }
};

/**
 * Mount one set's files into the working directory.
 *
 * `files` are `{ course, unit, name, as }` from the manifest; `as` is what the student's
 * own code will open. Already-mounted names are skipped, so loading a set twice is free and
 * loading two sets is additive - the same shape as adding a dataset to the SQL session.
 */
export async function addFiles(files, urlFor, { onStatus = () => {} } = {}) {
  onStatus(started() ? '' : 'Starting Python…');
  const pyodide = await session();

  /* FEATHER NEEDS pyarrow, AND NOTHING WOULD ASK FOR IT.
   *
   * `pd.read_feather(...)` names no module, so the import scan that loads a package on
   * demand sees nothing to load - the student gets pandas' "Missing optional dependency
   * 'pyarrow'" from a line that mentions no dependency at all. Handled here because this is
   * where the file extension is known, and derived from the files rather than declared in
   * the manifest, so a set stops needing it by no longer holding one.
   *
   * It is the one package loaded ahead of use rather than on demand, which is why it is
   * announced. */
  if (files.some(f => /\.feather$/i.test(f.as || f.name)) && !pyodide.loadedPackages?.pyarrow) {
    onStatus('Loading pyarrow, for the feather files…');
    await pyodide.loadPackage('pyarrow');
  }

  for (const f of files) {
    const as = f.as || f.name;
    if (mounted.has(as)) continue;
    const r = await fetch(urlFor(f), { credentials: 'include' });
    if (!r.ok) throw new Error(`cannot load ${as} (${r.status})`);
    pyodide.FS.writeFile(`${WORKDIR}/${as}`, new Uint8Array(await r.arrayBuffer()));
    mounted.add(as);
  }
  onStatus('');
}

/**
 * Run the student's code.
 *
 * `onStatus` is called with a sentence before anything slow happens, because the failure
 * mode this has to avoid is a cell that sits there for six seconds while a wheel downloads
 * and the student concludes the Playground is broken.
 *
 * Returns `{ out, error, value, figures, ms }`. Nothing throws for a Python error - a
 * traceback is output.
 */
export async function run(code, { onStatus = () => {} } = {}) {
  const t0 = performance.now();
  onStatus(started() ? '' : 'Starting Python…');
  const pyodide = await session();

  /* RESOLVE IMPORTS BEFORE EXECUTING, rather than letting the import fail.
   *
   * Pyodide's own `loadPackagesFromImports` does the scan and the fetching; the reporting
   * is ours, and it is the part that matters. Asked of the interpreter rather than tracked
   * here, so the answer is what is actually importable right now. */
  let names = [];
  try {
    const found = toJs(pyodide.pyodide_py.code.find_imports(code));
    names = toJs(pyodide.globals.get('_ice_missing')(found));
  } catch { names = []; }

  if (names.length) {
    onStatus(`Loading ${names.join(', ')}…`);
    try { await pyodide.loadPackagesFromImports(code); } catch { /* reported below */ }
    /* Anything Pyodide does not bundle but we vendor a wheel for. micropip's `emfs:` scheme
     * over a file we wrote ourselves, rather than an http URL: the same route the grader
     * takes, and the one that works in Node as well as the browser. */
    const still = toJs(pyodide.globals.get('_ice_missing')(names));
    const wheels = still.map(n => WHEEL_FOR[n]).filter(Boolean);
    if (wheels.length) {
      const micropip = pyodide.pyimport('micropip');
      try { pyodide.FS.mkdir('/ice-wheels'); } catch { /* already there */ }
      for (const w of wheels) {
        pyodide.FS.writeFile(`/ice-wheels/${w}`, await readWheel(w));
        await micropip.install([`emfs:/ice-wheels/${w}`]);
      }
    }
  }

  onStatus('');
  const result = toJs(pyodide.globals.get('_ice_run')(code));
  return { ...result, ms: Math.round(performance.now() - t0) };
}

/**
 * Clear the namespace, close the figures and unmount the data.
 *
 * Named honestly in the UI: this is not a new interpreter. Imports survive, and so does any
 * state inside them. A page reload is the "really start again", and costs nothing extra
 * because the tab is going anyway.
 */
export async function reset() {
  const pyodide = await session();
  pyodide.globals.get('_ice_reset')();
  for (const name of mounted) {
    try { pyodide.FS.unlink(`${WORKDIR}/${name}`); } catch { /* already gone */ }
  }
  mounted.clear();
}

/** What the session currently holds - frames, their columns, and the mounted files. */
export async function shape() {
  const pyodide = await session();
  return toJs(pyodide.globals.get('_ice_shape')());
}

/* ONE PAGE OF A FRAME OR A MOUNTED FILE, for the data browser.
 *
 * `kind` is 'file' or 'frame': a file is read off the working directory and cached, a frame
 * is looked up in the student's namespace every time. `col` is an INDEX into `columns`, not
 * a name - see _ice_match for why.
 *
 * This needs the interpreter, and a CSV does not: `playground-browse.js` reads those in
 * plain JavaScript instead, so the pane works while Pyodide is still booting. What comes
 * here is what only pandas can open - a .feather file - and anything the student built.
 */
export async function browse(kind, name, { q = '', col = null, offset = 0, limit = 100 } = {}) {
  const pyodide = await session();
  return toJs(pyodide.globals.get('_ice_browse')(kind, name, q, col, offset, limit));
}
