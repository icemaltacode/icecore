#!/usr/bin/env node
/* icecore - the ICE practice platform.
 *
 *   icecore build  [contentDir] [--out dir]   publish content as static files
 *   icecore verify [contentDir]               check every solution grades itself correct
 *   icecore dev    [contentDir] [--port n]    run the player against a content directory
 *   icecore bundle [contentDir] [--out dir]   build a deployable site (app + content)
 *
 * contentDir defaults to ./content, so inside a course repo the commands take no arguments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../src/extensions.mjs';
import { buildContent, stepProblems } from '../src/build.mjs';
import { compareResults } from '../app/src/compare.js';
import { validate as validateDragDrop, allItems } from '../app/src/dragdrop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');

const argv = process.argv.slice(2);
const cmd = argv[0];

// One pass, so a flag's value is consumed rather than also counting as a positional -
// `icecore bundle --out dist` must not read "dist" as the content directory. Both
// `--name value` and `--name=value` are accepted; every flag takes a value today, so a
// missing one is an error rather than a boolean.
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('-')) { positional.push(arg); continue; }
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq !== -1) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-')) die(`${arg} needs a value`);
  flags[arg.slice(2)] = value;
  i++;
}
const flag = (name, fallback) => (name in flags ? flags[name] : fallback);

const contentDir = path.resolve(positional[0] || 'content');
if (!fs.existsSync(contentDir)) die(`No content directory at ${contentDir}`);

function die(msg) { console.error(`icecore: ${msg}`); process.exit(1); }

switch (cmd) {
  case 'build':  await cmdBuild(); break;
  case 'verify': await cmdVerify(); break;
  case 'dev':    await cmdDev(); break;
  case 'bundle': await cmdBundle(); break;
  default:
    console.log(`icecore - ICE practice platform

  icecore build  [contentDir] [--out dir]   publish content as static files (default out: dist)
  icecore verify [contentDir]               check every solution grades itself correct
  icecore dev    [contentDir] [--port n]    run the player against a content directory
  icecore bundle [contentDir] [--out dir]   build a deployable site (app + content)

contentDir defaults to ./content.`);
    process.exit(cmd ? 1 : 0);
}

// ---------------------------------------------------------------------------
async function cmdBuild(outDir = path.resolve(flag('out', 'dist'))) {
  console.log(`building ${path.relative(process.cwd(), contentDir) || '.'} -> ${path.relative(process.cwd(), outDir)}/content`);
  const r = await buildContent({ contentDir, outDir });
  if (r.failed) die(`${r.failed} solution(s) failed to run - fix them before publishing`);
  console.log(`\nwrote ${outDir}/content (${r.manifest.length} course${r.manifest.length === 1 ? '' : 's'})`);
  return outDir;
}

async function cmdVerify() {
  console.log(`verifying ${path.relative(process.cwd(), contentDir) || '.'}`);
  // built in memory: reference solutions never touch the disk
  const { courses, datasets } = await buildContent({ contentDir, write: false });

  const seeded = new Map();
  const template = async name => {
    if (!seeded.has(name)) {
      const db = new PGlite({ extensions: EXTENSIONS });
      await db.exec(datasets[name]);
      const dump = await db.dumpDataDir();
      await db.close();
      seeded.set(name, dump);
    }
    return seeded.get(name);
  };
  // An exercise's setup SQL is applied once and dumped, so its derived tables are present
  // in every database the exercise's steps run against. Checked on its own before any
  // solution runs: a broken filter would otherwise surface as every solution in the
  // exercise failing for a reason that points nowhere near the cause.
  const withSetup = new Map();
  const startingPoint = async (dataset, setup) => {
    if (!setup) return template(dataset);
    const k = `${dataset}\u0000${setup}`;
    if (!withSetup.has(k)) {
      withSetup.set(k, (async () => {
        const db = new PGlite({ loadDataDir: await template(dataset), extensions: EXTENSIONS });
        try {
          await db.exec(setup);
          return await db.dumpDataDir();
        } finally { await db.close(); }
      })());
    }
    return withSetup.get(k);
  };
  const runQuery = async (dataset, sql, setup) => {
    const db = new PGlite({ loadDataDir: await startingPoint(dataset, setup), extensions: EXTENSIONS });
    try {
      const res = await db.exec(sql);
      const last = res[res.length - 1];
      return { fields: (last?.fields || []).map(f => f.name), rows: last?.rows || [] };
    } finally { await db.close(); }
  };

  let pass = 0, fail = 0, sample = null, dnd = 0, mcqSteps = 0, setups = 0;
  const bad = [];
  for (const course of courses) {
    for (const unit of course.units) {
      for (const ex of unit.exercises) {
        // Drag-and-drop has no SQL to run: the content itself is what gets checked.
        if (ex.type === 'dragdrop') {
          const problems = validateDragDrop(ex);
          if (problems.length) bad.push(...problems.map(p => `${unit.unit} ${ex.file}: ${p}`));
          else dnd++;
          continue;
        }
        if (ex.type !== 'coding') continue;
        // Step shape is checked before anything is run, and independently of the dataset:
        // a dropped question is invisible otherwise, because the other steps still pass.
        for (const problem of stepProblems(ex)) { fail++; bad.push(`${unit.unit} ${ex.file}: ${problem}`); }
        mcqSteps += (ex.steps || []).filter(st => st.kind === 'mcq').length;

        if (!ex.dataset || !datasets[ex.dataset]) continue;

        if (ex.setup) {
          try { await startingPoint(ex.dataset, ex.setup); }
          catch (e) {
            fail++;
            bad.push(`${unit.unit} ${ex.file}: setup failed - ${String(e.message).split('\n')[0]}`);
            continue;
          }
          setups++;
        }
        for (const [i, step] of (ex.steps || []).entries()) {
          if (!step.solution) continue;
          const label = `${unit.unit} ${ex.file}${ex.steps.length > 1 ? ` step ${i + 1}` : ''}`;
          if (!step.expected) { fail++; bad.push(`${label}: no expected result computed`); continue; }
          const v = compareResults(step.expected, await runQuery(ex.dataset, step.solution, ex.setup));
          if (v.pass) pass++; else { fail++; bad.push(`${label}: ${v.reason}`); }
          sample ||= { step, dataset: ex.dataset, setup: ex.setup };
        }
      }
    }
  }

  let neg = 'skipped';
  if (sample) {
    const wrong = await runQuery(sample.dataset, 'SELECT 1 AS definitely_not_the_answer;', sample.setup);
    neg = compareResults(sample.step.expected, wrong).pass ? 'FAILED' : 'ok';
    if (neg === 'FAILED') bad.push('negative control: a wrong query was accepted');
  }

  console.log(`\nsolutions that self-grade correct: ${pass}`);
  if (dnd) console.log(`drag-and-drop exercises with a sound answer: ${dnd}`);
  if (mcqSteps) console.log(`multiple-choice steps: ${mcqSteps}`);
  if (setups) console.log(`exercises with setup SQL that runs: ${setups}`);
  console.log(`failures: ${fail}`);
  console.log(`negative control (wrong query rejected): ${neg}`);
  if (bad.length) { console.log('\n' + bad.join('\n')); process.exit(1); }
}

async function cmdDev() {
  const staging = path.join(contentDir, '..', '.icecore');   // see cmdBundle
  await buildContent({ contentDir, outDir: staging });
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: path.join(APP, 'vite.config.js'),
    root: APP,
    publicDir: staging,
    server: { port: Number(flag('port', 5173)), open: true },
  });
  await server.listen();
  server.printUrls();
}

async function cmdBundle() {
  const outDir = path.resolve(flag('out', 'dist'));
  // Its own staging directory, deliberately: building the content wipes and recreates it,
  // and a `dev` server serving the same path keeps the old handle and starts answering
  // every content request with the index page instead.
  const staging = path.join(contentDir, '..', '.icecore-bundle');
  const r = await buildContent({ contentDir, outDir: staging });
  if (r.failed) die(`${r.failed} solution(s) failed to run - fix them before publishing`);
  const { build } = await import('vite');
  await build({
    configFile: path.join(APP, 'vite.config.js'),
    root: APP,
    publicDir: staging,
    build: { outDir, emptyOutDir: true },
  });
  console.log(`\ndeployable site in ${path.relative(process.cwd(), outDir)}/`);
}
