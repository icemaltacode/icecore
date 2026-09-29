/* End-to-end: does a plotting exercise hand back a figure, does an openpyxl one hand back
 * a workbook, and does grading still grade? Real Pyodide, real wheels, real pythonwhat. */
import fs from 'node:fs';
import path from 'node:path';
import { loadPyodide } from 'pyodide';
import { createGrader } from '../app/src/python.js';

const WHEEL_DIR = new URL('../app/py', import.meta.url).pathname;
const readWheel = name => fs.promises.readFile(path.join(WHEEL_DIR, name));

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- matplotlib
{
  const pyodide = await loadPyodide();
  const g = await createGrader({ pyodide, packages: ['matplotlib', 'numpy'], readWheel });
  pyodide.FS.mkdirTree('/ice-data/module-2');

  const pec = 'import matplotlib.pyplot as plt\nyear = [1950, 1970, 1990, 2010]\npop = [2.5, 3.7, 5.3, 6.9]';
  const code = 'plt.plot(year, pop)\nprint("drew it")\nplt.show()';

  const run = await g.run({ pec, submission: code, cwd: '/ice-data/module-2' });
  check('a plot comes back as a figure', run.figures.length === 1,
        `figures=${run.figures.length} output=${JSON.stringify(run.output)}`);
  check('the figure is a real PNG',
        Buffer.from(run.figures[0] || '', 'base64').subarray(1, 4).toString() === 'PNG');
  check('stdout still comes back', run.output.trim() === 'drew it');
  check('the run wrote no files', run.files.length === 0);

  // A setup that makes the figure and a submission that draws into it: the student must
  // still see it, which is why the prologue closes BEFORE the setup rather than after.
  const shared = await g.run({
    pec: 'import matplotlib.pyplot as plt\nfig, ax = plt.subplots()',
    submission: 'ax.plot([1, 2, 3], [4, 5, 6])',
    cwd: '/ice-data/module-2',
  });
  check("a figure made in ## Setup is still the student's", shared.figures.length === 1,
        `figures=${shared.figures.length}`);

  // Grading: the solution runs first, in the same interpreter. Only the student's figure
  // may come back, and the verdict must be unaffected.
  const graded = await g.grade({
    pec, solution: code, submission: code, capture: true,
    sct: 'Ex().has_printout(0)\nsuccess_msg("yes")', cwd: '/ice-data/module-2',
  });
  check('grading still grades', graded.correct === true, graded.message);
  check('grading returns one figure, not the solution\'s too', graded.figures.length === 1,
        `figures=${graded.figures.length}`);

  const wrong = await g.grade({
    pec, solution: code, submission: 'plt.plot(pop, year)', capture: true,
    sct: 'Ex().has_printout(0)', cwd: '/ice-data/module-2',
  });
  check('a wrong answer is still wrong', wrong.correct === false);
  check('...and still shows what it drew', wrong.figures.length === 1);

  const quiet = await g.grade({
    pec, solution: code, submission: code, capture: false,
    sct: 'Ex().has_printout(0)', cwd: '/ice-data/module-2',
  });
  check('capture:false collects nothing (the builder\'s path)', quiet.figures.length === 0);
}

// ------------------------------------------------------------------ openpyxl
{
  const pyodide = await loadPyodide();
  const g = await createGrader({ pyodide, packages: [], wheels: ['openpyxl'], readWheel });
  pyodide.FS.mkdirTree('/ice-data/module-1');

  const code = [
    'from openpyxl import Workbook',
    'wb = Workbook()',
    'ws = wb.active',
    'ws.title = "Players"',
    'for column, title in enumerate(["Name", "Height"], start=1):',
    '    ws.cell(row=1, column=column, value=title)',
    'wb.save("report.xlsx")',
    'print(ws.title)',
  ].join('\n');

  const run = await g.run({ pec: '', submission: code, cwd: '/ice-data/module-1' });
  check('openpyxl imports from the vendored wheel', !run.error, run.error);
  check('the workbook is offered back', run.files.includes('report.xlsx'),
        `files=${JSON.stringify(run.files)}`);
  check('...and it is a real xlsx',
        Buffer.from(pyodide.FS.readFile('/ice-data/module-1/report.xlsx'))
          .subarray(0, 2).toString() === 'PK');

  // Twice in a row: the second Run must still offer the file. This is the failure that
  // running the submission as both sides of a grade used to cause.
  const again = await g.run({ pec: '', submission: code, cwd: '/ice-data/module-1' });
  check('running it again still offers the file', again.files.includes('report.xlsx'),
        `files=${JSON.stringify(again.files)}`);

  // The mounted data must not be reported as something the student wrote.
  pyodide.FS.writeFile('/ice-data/module-1/baseball.csv', 'Name,Height\nA,1\n');
  const noise = await g.run({ pec: '', submission: 'print(open("baseball.csv").read())',
                              cwd: '/ice-data/module-1' });
  check('reading a data file writes nothing', noise.files.length === 0,
        `files=${JSON.stringify(noise.files)}`);

  const graded = await g.grade({
    pec: '', solution: code, submission: code, capture: true,
    sct: 'Ex().check_object("ws")\nsuccess_msg("yes")', cwd: '/ice-data/module-1',
  });
  check('an openpyxl exercise grades', graded.correct === true, graded.message);

  /* ---- AND AN EXERCISE WITH NO DATA FILES AT ALL --------------------------
   *
   * THE ONE THAT SHIPPED BROKEN, and every check above missed it for the same reason: they
   * all pass a mounted data directory, where the directory the run happens in and the
   * directory the caller reads from happen to be the same string.
   *
   * 1.2.1 "Your First Workbook" declares no `data:`, so `mountData` mounts nothing and hands
   * back the empty string - and the run then happens in the interpreter's HOME. The caller
   * joined each filename onto the empty string it had passed in, read from the filesystem
   * root, found nothing, and silently offered the student no workbook. They pressed Run, saw
   * their output, and the download link they were told about never appeared.
   *
   * So the run reports where it actually happened, and this is the assertion that says so.
   */
  const home = await g.run({ pec: '', submission: code, cwd: '' });
  check('an exercise with no data files still writes its workbook',
        home.files.includes('report.xlsx'), `files=${JSON.stringify(home.files)}`);
  check('and says which directory to read it from',
        !!home.cwd && home.cwd !== '', JSON.stringify(home.cwd));
  check('...which is where the file actually is',
        Buffer.from(pyodide.FS.readFile(`${home.cwd}/report.xlsx`))
          .subarray(0, 2).toString() === 'PK', `${home.cwd}/report.xlsx`);
  /* The bug in one line: this is the path the caller used to build. */
  check('and NOT the filesystem root, which is what joining onto "" gives',
        home.cwd !== '/' && !`/report.xlsx`.startsWith(`${home.cwd}/`), home.cwd);
}

// ---------------------------------------------------------------- completion
/* What the editor may offer, from the live objects an exercise's setup made: the names it
 * defined, a DataFrame's methods and columns, a module's functions. Read from a namespace of
 * its own, which a Run must never see. */
{
  const pyodide = await loadPyodide();
  const g = await createGrader({ pyodide, packages: ['pandas'], readWheel });
  pyodide.FS.mkdirTree('/ice-data/module-3');
  pyodide.FS.writeFile('/ice-data/module-3/homelessness.csv',
                       'region,state,individuals\nPacific,California,109008\nMountain,Utah,1904\n');
  const cwd = '/ice-data/module-3';
  const labels = rows => (rows || []).map(r => r[0]);
  const row = (rows, label) => (rows || []).find(r => r[0] === label);

  check('nothing is offered before the setup has run', g.complete('name', '', 'hom') === null);

  g.hints({ pec: "import pandas as pd\nprint('noise')\nhomelessness = pd.read_csv('homelessness.csv')",
            cwd });
  const names = g.complete('name', '', 'hom');
  check("the setup's own names are offered", labels(names).includes('homelessness'),
        JSON.stringify(names));
  check('and say what they are', row(names, 'homelessness')?.[2] === 'DataFrame',
        JSON.stringify(row(names, 'homelessness')));

  const methods = g.complete('attr', 'homelessness', 'he');
  check("a DataFrame's methods follow its name", row(methods, 'head')?.[1] === 'method',
        JSON.stringify(methods));
  const cols = g.complete('attr', 'homelessness', '');
  check('and its columns, as columns', row(cols, 'state')?.[2] === 'column',
        JSON.stringify(row(cols, 'state')));
  check('without running a property to name it', row(cols, 'T')?.[1] === 'property',
        JSON.stringify(row(cols, 'T')));
  check('private names stay out of the way', !labels(cols).some(l => l.startsWith('_')));

  const keys = g.complete('key', 'homelessness', 'st');
  check('inside homelessness["...", its column names', JSON.stringify(labels(keys)) === '["state"]',
        JSON.stringify(keys));
  check("a module's functions follow its name",
        row(g.complete('attr', 'pd', 'read_c'), 'read_csv')?.[1] === 'function');
  check('something that does not exist offers nothing rather than failing',
        JSON.stringify(g.complete('attr', 'nothing_here', '')) === '[]');

  const run = await g.run({ pec: '', submission: "print('homelessness' in globals())", cwd });
  check("a Run never sees the editor's namespace", run.output.trim() === 'False', run.output);

  /* ---- where the code stops being Python, for the editor's red line ----
   * Compiled, never run: the position is the one a Run would report, and nothing the code
   * does happens. */
  check('code that compiles has nothing wrong with it', g.syntax('x = 1\nprint(x)') === null);
  const open = g.syntax('x = [1, 2\nprint(x)');
  check('an unclosed bracket is found where it opens',
        open?.[0] === 1 && open?.[1] === 5 && /never closed/.test(open?.[4]), JSON.stringify(open));
  const colon = g.syntax('if x > 1\n    print(x)');
  check('a missing colon is found on its line', colon?.[0] === 1 && /expected ':'/.test(colon?.[4]),
        JSON.stringify(colon));
  const indent = g.syntax('def f():\nreturn 1');
  check('an indentation error is an error too', indent?.[0] === 2, JSON.stringify(indent));
  g.syntax("open('/tmp/ice-should-not-exist', 'w')");
  check('checking runs nothing', !pyodide.FS.analyzePath('/tmp/ice-should-not-exist').exists);
  check('a warning is not an error', g.syntax('s = "\\d"') === null);
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
