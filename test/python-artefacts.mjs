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
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
