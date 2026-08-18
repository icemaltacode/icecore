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
import { buildContent } from '../src/build.mjs';
import { compareResults } from '../app/src/compare.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter(a => !a.startsWith('-'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

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
      const db = new PGlite();
      await db.exec(datasets[name]);
      const dump = await db.dumpDataDir();
      await db.close();
      seeded.set(name, dump);
    }
    return seeded.get(name);
  };
  const runQuery = async (dataset, sql) => {
    const db = new PGlite({ loadDataDir: await template(dataset) });
    try {
      const res = await db.exec(sql);
      const last = res[res.length - 1];
      return { fields: (last?.fields || []).map(f => f.name), rows: last?.rows || [] };
    } finally { await db.close(); }
  };

  let pass = 0, fail = 0, sample = null;
  const bad = [];
  for (const course of courses) {
    for (const unit of course.units) {
      for (const ex of unit.exercises) {
        if (ex.type !== 'coding' || !ex.dataset || !datasets[ex.dataset]) continue;
        for (const [i, step] of (ex.steps || []).entries()) {
          if (!step.solution) continue;
          const label = `${unit.unit} ${ex.file}${ex.steps.length > 1 ? ` step ${i + 1}` : ''}`;
          if (!step.expected) { fail++; bad.push(`${label}: no expected result computed`); continue; }
          const v = compareResults(step.expected, await runQuery(ex.dataset, step.solution));
          if (v.pass) pass++; else { fail++; bad.push(`${label}: ${v.reason}`); }
          sample ||= { step, dataset: ex.dataset };
        }
      }
    }
  }

  let neg = 'skipped';
  if (sample) {
    const wrong = await runQuery(sample.dataset, 'SELECT 1 AS definitely_not_the_answer;');
    neg = compareResults(sample.step.expected, wrong).pass ? 'FAILED' : 'ok';
    if (neg === 'FAILED') bad.push('negative control: a wrong query was accepted');
  }

  console.log(`\nsolutions that self-grade correct: ${pass}`);
  console.log(`failures: ${fail}`);
  console.log(`negative control (wrong query rejected): ${neg}`);
  if (bad.length) { console.log('\n' + bad.join('\n')); process.exit(1); }
}

async function cmdDev() {
  const staging = path.join(contentDir, '..', '.icecore');
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
  const staging = path.join(contentDir, '..', '.icecore');
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
