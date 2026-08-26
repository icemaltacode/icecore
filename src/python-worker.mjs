#!/usr/bin/env node
/* Validate one package set's Python exercises, in a process of its own.
 *
 * WHY A SEPARATE PROCESS. An interpreter must hold exactly the packages its exercise
 * declared - see `packageKey` in app/src/python.js - and Pyodide cannot unload a module, so
 * a course with 25 distinct package sets needs 25 interpreters. It has no teardown API
 * either: dropping the reference is all a caller can do, and V8 will not reclaim several
 * hundred megabytes of wasm heap fast enough to keep up.
 *
 * Doing that in one process worked on a laptop and died on a CI runner with
 *
 *   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 *
 * after four sets. A process per set bounds it absolutely: the OS reclaims everything on
 * exit, and the cost is one node start against a Pyodide boot that already dominates.
 *
 * IN AND OUT BY FILE, not stdio. Pyodide announces every package it loads, and the
 * submissions themselves print - that is the whole point of `has_printout` - so stdout is
 * full of other people's output and cannot also be a protocol.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPyodide } from 'pyodide';
import { createGrader } from '../app/src/python.js';

const [jobFile, outFile] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));

const pyodide = await loadPyodide();
const grader = await createGrader({
  pyodide,
  packages: job.packages,
  wheels: job.wheels,
  readWheel: name => fs.promises.readFile(path.join(job.wheelDir, name)),
});

/* Mounted once per data directory, per process. A DataCamp course's files are shared by
 * every exercise in it and some are megabytes; re-reading them per exercise would dwarf
 * the grading. The directory is a module's - `module-4` - which the caller decides; this
 * only joins it to job.dataDir. */
const mounted = new Set();
const mount = sub => {
  const at = `/ice-data/${sub}`;
  if (mounted.has(sub)) return at;
  mounted.add(sub);
  pyodide.FS.mkdirTree(at);
  const dir = path.join(job.dataDir, sub);
  for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []))
    if (fs.statSync(path.join(dir, f)).isFile())
      pyodide.FS.writeFile(`${at}/${f}`, fs.readFileSync(path.join(dir, f)));
  return at;
};

const results = [];
for (const ex of job.exercises) {
  const cwd = mount(ex.dataDir);
  const outcome = { setupError: null, steps: [] };
  for (const step of ex.steps) {
    if (!step.solution || !step.sct) { outcome.steps.push(null); continue; }
    try {
      /* Normally the reference solution is graded against itself, which asks whether the
       * SCT ACCEPTS the right answer. A caller may instead supply its own `submission` and
       * `expect: 'incorrect'` to ask the other half - whether the SCT REJECTS a wrong one.
       * An SCT that is present but vacuous passes the first question and fails the second,
       * and it is the failure `build` refuses a missing "### Check" to avoid. */
      const wrong = step.expect === 'incorrect';
      const r = await grader.grade({ pec: ex.setup, solution: step.solution,
                                     submission: step.submission ?? step.solution, sct: step.sct,
                                     cwd, seed: ex.seed });
      const clean = String(r.message || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      outcome.steps.push(r.correct === !wrong
        ? { expected: { python: true }, message: clean }
        : { error: wrong
              ? 'the SCT accepts a submission that does not do the exercise - it would accept '
                + 'every answer, which is what a missing "### Check" would have done'
              : `the reference solution does not satisfy its own SCT - ${clean.slice(0, 160)}` });
    } catch (e) {
      /* Last line, not first: a pythonwhat failure arrives as a Python traceback and the
       * first line is always "Traceback (most recent call last):". The bottom line carries
       * the exception and its message, which is what says what the solution did wrong. */
      const lines = String(e.message).trim().split('\n').filter(Boolean);
      outcome.steps.push({ error: `SCT raised - ${(lines[lines.length - 1] || '').trim().slice(0, 200)}` });
    }
  }
  results.push({ key: ex.key, outcome });
}

fs.writeFileSync(outFile, JSON.stringify(results));
