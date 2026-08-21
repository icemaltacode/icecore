#!/usr/bin/env node
/* icecore - the ICE practice platform.
 *
 *   icecore build  [contentDir] [--out dir]   publish content as static files
 *   icecore verify [contentDir]               check every solution grades itself correct
 *   icecore dev    [contentDir] [--port n] [--as role]
 *                                             run the player against a content directory
 *   icecore bundle [contentDir...] [--out dir] build a deployable site (app + content)
 *
 * `dev --as student|admin|signin` fakes the whole authenticated session locally, so the
 * signed-in screens can be worked on without AWS. See app/src/preview.js.
 *
 * contentDir defaults to ./content, so inside a course repo the commands take no arguments.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../src/extensions.mjs';
import { buildContent, stepProblems } from '../src/build.mjs';
import { slidesSrcDir, deckFiles, readDecks, affectedDecks } from '../src/decks.mjs';
import { compareResults } from '../app/src/compare.js';
import { validate as validateDragDrop, allItems } from '../app/src/dragdrop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');

const argv = process.argv.slice(2);
const cmd = argv[0];

// One pass, so a flag's value is consumed rather than also counting as a positional -
// `icecore bundle --out dist` must not read "dist" as the content directory. Both
// `--name value` and `--name=value` are accepted. Flags take a value unless they are named
// here, and a missing value is an error rather than a silent boolean: `--since` with
// nothing after it must not quietly mean "rebuild everything".
const BOOLEAN = new Set(['list', 'dry-run']);
const flags = {};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('-')) { positional.push(arg); continue; }
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq !== -1) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
  const name = arg.slice(2);
  if (BOOLEAN.has(name)) { flags[name] = true; continue; }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('-')) die(`${arg} needs a value`);
  flags[name] = value;
  i++;
}
const flag = (name, fallback) => (name in flags ? flags[name] : fallback);
const has = name => name in flags;

/* One site can carry more than one course, so `build`, `dev` and `bundle` take a content
 * directory PER COURSE. A content repo is still one course - that has not changed - but the
 * site they publish into is shared, and being able to run the grid the way a student sees
 * it means being able to point at several checkouts at once.
 *
 * `verify` and `slides` stay single: both are about one course's own material, and running
 * them across repos would only make it unclear which one failed. They use the first. */
const contentDirs = (positional.length ? positional : ['content']).map(d => path.resolve(d));
for (const d of contentDirs) if (!fs.existsSync(d)) die(`No content directory at ${d}`);
const contentDir = contentDirs[0];

function die(msg) { console.error(`icecore: ${msg}`); process.exit(1); }

switch (cmd) {
  case 'build':  await cmdBuild(); break;
  case 'verify': await cmdVerify(); break;
  case 'dev':    await cmdDev(); break;
  case 'bundle': await cmdBundle(); break;
  case 'slides': await cmdSlides(); break;
  default:
    console.log(`icecore - ICE practice platform

  icecore build  [contentDir...] [--out dir]  publish content as static files (default out: dist)
  icecore verify [contentDir]               check every solution grades itself correct
  icecore dev    [contentDir...] [--port n]   run the player against a content directory
                 [--as student|admin|signin]  ...as a signed-in user, with no AWS
  icecore bundle [contentDir...] [--out dir] build a deployable site (app + content)
  icecore slides [contentDir]               build the course's per-topic decks
                 [--since <sha>]              ...only those a change since <sha> affects
                 [--only 1.1.1,1.2.3]         ...only these
                 [--list]                     say what would be built, build nothing

contentDir defaults to ./content. build, dev and bundle take one per course - a site
may carry several - while verify and slides work on the first.`);
    process.exit(cmd ? 1 : 0);
}

// ---------------------------------------------------------------------------
async function cmdBuild(outDir = path.resolve(flag('out', 'dist'))) {
  const manifest = await buildAll(outDir);
  console.log(`\nwrote ${outDir}/content (${manifest.length} course${manifest.length === 1 ? '' : 's'})`);
  return outDir;
}

/* Build every content directory into one site, and write the catalogue once.
 *
 * The per-course builds cannot each write `courses.json` - the second would replace the
 * first with a list of one - so they are told not to, and the merged list is written here.
 * That is the same shape the publish pipeline has to take for two course repos publishing
 * into one bucket, which is why it is worth having locally: the grid a student sees is the
 * thing being run, not an approximation of it. */
async function buildAll(outDir) {
  const manifest = [];
  for (const dir of contentDirs) {
    console.log(`building ${path.relative(process.cwd(), dir) || '.'} -> ${path.relative(process.cwd(), outDir)}/content`);
    const r = await buildContent({ contentDir: dir, outDir, writeManifest: false });
    if (r.failed) die(`${r.failed} solution(s) failed to run - fix them before publishing`);
    manifest.push(...r.manifest);
  }
  fs.writeFileSync(path.join(outDir, 'content', 'courses.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function cmdVerify() {
  console.log(`verifying ${path.relative(process.cwd(), contentDir) || '.'}`);
  // built in memory: reference solutions never touch the disk
  const { courses, datasets, missingImages, missingApps, missingSections, missingChecks } =
    await buildContent({ contentDir, write: false });

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

  let pass = 0, fail = 0, sample = null, dnd = 0, mcqSteps = 0, setups = 0, loose = 0;
  const bad = [];
  // A figure that isn't there is why this check exists: the prompt still reads fine and the
  // exercise still grades, so nothing else would ever notice. A section pointing at a slide
  // the deck doesn't have is the same shape of bug, and gets the same treatment.
  for (const m of [...missingImages, ...missingApps, ...missingSections, ...missingChecks]) { fail++; bad.push(m); }
  for (const course of courses) {
    for (const unit of course.modules.flatMap(m => m.units).flatMap(u => u.topics)) {
      for (const ex of unit.exercises) {
        // Drag-and-drop has no SQL to run: the content itself is what gets checked.
        if (ex.type === 'dragdrop') {
          const problems = validateDragDrop(ex);
          if (problems.length) bad.push(...problems.map(p => `${unit.topic} ${ex.file}: ${p}`));
          else dnd++;
          continue;
        }
        if (ex.type !== 'coding') continue;
        // Step shape is checked before anything is run, and independently of the dataset:
        // a dropped question is invisible otherwise, because the other steps still pass.
        for (const problem of stepProblems(ex)) { fail++; bad.push(`${unit.topic} ${ex.file}: ${problem}`); }
        mcqSteps += (ex.steps || []).filter(st => st.kind === 'mcq').length;

        if (!ex.dataset || !datasets[ex.dataset]) continue;

        if (ex.setup) {
          try { await startingPoint(ex.dataset, ex.setup); }
          catch (e) {
            fail++;
            bad.push(`${unit.topic} ${ex.file}: setup failed - ${String(e.message).split('\n')[0]}`);
            continue;
          }
          setups++;
        }
        for (const [i, step] of (ex.steps || []).entries()) {
          if (!step.solution) continue;
          const label = `${unit.topic} ${ex.file}${ex.steps.length > 1 ? ` step ${i + 1}` : ''}`;
          if (!step.expected) { fail++; bad.push(`${label}: no expected result computed`); continue; }
          const v = compareResults(step.expected, await runQuery(ex.dataset, step.solution, ex.setup));
          if (v.pass) pass++; else { fail++; bad.push(`${label}: ${v.reason}`); }
          if (step.nondeterministic) loose++;
          // The negative control needs a step whose values are actually checked.
          if (!step.nondeterministic) sample ||= { step, dataset: ex.dataset, setup: ex.setup };
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
  if (loose) console.log(`steps graded on shape only (non-deterministic): ${loose}`);
  console.log(`failures: ${fail}`);
  console.log(`negative control (wrong query rejected): ${neg}`);
  if (bad.length) { console.log('\n' + bad.join('\n')); process.exit(1); }
}

async function cmdDev() {
  /* Per port, because buildContent WIPES its output directory on startup. Two dev servers
   * sharing one staging dir means the second one to boot deletes the first one's content
   * out from under it, and the first then answers every content request with the app's own
   * index page - a 200, with HTML, which fails as "unexpected token <" somewhere far away.
   * `bundle` already had its own directory for exactly this reason; `dev` didn't, because
   * nobody ran two. With several sessions on one machine, two is normal.
   *
   * THE PORT HAS TO BE SETTLED BEFORE THE BUILD, not taken from the flag. Vite quietly
   * moves to the next free port when the requested one is taken, so two servers started
   * with the same --port keep the same *staging* directory while ending up on different
   * ports - and the second still wipes the first. That is not the bug's edge case, it is
   * how it actually happened here: a server on 5175 was serving .icecore/5174 when a second
   * invocation rebuilt exactly that directory sixteen minutes later. Claim the port first,
   * key the staging on what was actually claimed, and tell Vite it may not drift. */
  const port = await freePort(Number(flag('port', 5173)));
  // Staged beside the FIRST content directory: with several courses there is no shared
  // parent to put it under, and the first is the one you were standing in.
  const staging = path.join(contentDir, '..', '.icecore', String(port));
  await buildAll(staging);
  // Vite picks VITE_-prefixed variables up out of the environment, so this is all it takes
  // to reach import.meta.env in the app. It is read only under import.meta.env.DEV, which
  // `bundle` sets false - preview cannot leak into anything that ships.
  const as = flag('as');
  if (as) {
    if (!['student', 'admin', 'signin'].includes(as)) die(`--as must be student, admin or signin`);
    process.env.VITE_ICECORE_PREVIEW = as;
    console.log(`preview: running as a signed-in ${as === 'signin' ? 'user (starting at the sign-in screen)' : as}`);
  }
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: path.join(APP, 'vite.config.js'),
    root: APP,
    publicDir: staging,
    server: { port, strictPort: true, open: true },
  });
  await server.listen();
  server.printUrls();
}

/* The first free port at or above `from`. Checked by actually binding, because that is the
 * only answer that isn't a race with whatever else is starting up. */
async function freePort(from) {
  const net = await import('node:net');
  for (let port = from; port < from + 50; port++) {
    const ok = await new Promise(resolve => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
    if (ok) return port;
  }
  die(`no free port between ${from} and ${from + 50}`);
}

/* Build the course's per-topic decks - all of them, or only the ones a change actually
 * touched.
 *
 * This used to be a shell loop in each course's package.json:
 *
 *     for f in topic-*.md; do slidev build "$f" --base ... --out ...; done
 *
 * an unconditional glob with no change detection, which is how fixing a typo in one slide
 * came to rebuild 59 decks. The selection lives here rather than in the course repo so
 * there is one copy of it, and so the include graph it needs is the same one the sections
 * come out of.
 *
 * IT WRITES A MANIFEST. `<contentDir>/slides/.built.json` records what this run produced
 * and what the course currently has sources for. The publish step needs both: it syncs one
 * prefix per rebuilt deck (never `--delete` against slides/ as a whole, which would erase
 * every deck that wasn't rebuilt) and reconciles the rest against `all`.
 */
async function cmdSlides() {
  const srcDir = slidesSrcDir(contentDir);
  if (!fs.existsSync(srcDir)) die(`No slides/ beside ${contentDir} - nothing to build`);
  const outRoot = path.join(contentDir, 'slides');

  const sources = deckFiles(srcDir);
  if (!sources.size) die(`No topic-*.md in ${srcDir}`);
  const decks = await readDecks(srcDir, {
    onError: (topic, msg) => console.error(`  ! ${topic}: ${msg}`),
  });
  if (!decks.size)
    die(`@slidev/parser is not installed in ${srcDir} - run npm ci there first`);

  // What to build.
  let topics, why = 'no filter given, so all of them';
  let reasons = new Map();
  if (has('only')) {
    topics = String(flag('only')).split(',').map(s => s.trim()).filter(Boolean);
    const unknown = topics.filter(t => !decks.has(t));
    if (unknown.length) die(`no deck for ${unknown.join(', ')}`);
    why = '--only';
  } else if (has('since')) {
    const since = String(flag('since'));
    const changed = changedSince(since, path.dirname(srcDir));
    if (changed === null) {
      topics = [...decks.keys()];
      why = `cannot diff against ${since.slice(0, 8)} - falling back to every deck`;
    } else {
      const a = affectedDecks(decks, changed);
      ({ topics, reasons } = a);
      why = a.global.length
        ? `shared files changed (${a.global.slice(0, 3).join(', ')}`
          + `${a.global.length > 3 ? `, +${a.global.length - 3} more` : ''}), so every deck`
        : `${changed.length} file(s) changed since ${since.slice(0, 8)}`;
    }
  } else {
    topics = [...decks.keys()];
  }
  topics.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));

  console.log(`slides: ${topics.length} of ${decks.size} deck(s) to build - ${why}`);
  // Said out loud, because the failure mode of selective building is publishing less than
  // you meant to and never finding out.
  for (const t of topics) {
    const r = [...new Set(reasons.get(t) || [])];
    console.log(`  ${t}${r.length ? `  <- ${r.join(', ')}` : ''}`);
  }
  if (flags.list) return;
  if (!topics.length) { writeManifest(outRoot, [], [...decks.keys()]); return; }

  // Resolved from the course's own node_modules rather than npx: npx would happily go to
  // the network for a Slidev that must match the theme and the lockfile.
  const bin = path.join(srcDir, 'node_modules', '.bin', 'slidev');
  if (!fs.existsSync(bin)) die(`slidev is not installed in ${srcDir} - run npm ci there first`);

  const t0 = Date.now();
  for (const [i, topic] of topics.entries()) {
    const out = path.join(outRoot, topic);
    console.log(`\n[${i + 1}/${topics.length}] building ${topic}`);
    // --base has to match where the deck lands, or every asset it asks for 404s in
    // production while working perfectly from a dev server at the root.
    const r = spawnSync(bin, [
      'build', sources.get(topic),
      '--base', `/slides/${topic}/`,
      '--out', path.relative(srcDir, out),
    ], { cwd: srcDir, stdio: 'inherit' });
    if (r.status !== 0) die(`slidev build failed for ${topic}`);
    const p = pruneAssets(out, decks.get(topic).images);
    if (p.removed)
      console.log(`  pruned ${p.removed} unused file(s), ${mb(p.freed)} - ${p.kept} kept`);
  }
  writeManifest(outRoot, topics, [...decks.keys()]);
  console.log(`\nbuilt ${topics.length} deck(s) in ${Math.round((Date.now() - t0) / 1000)}s`);
}

/* Repo-relative paths changed between <sha> and the working tree. Null - not an empty list
 * - when git cannot answer, so the caller falls back to building everything: a first push,
 * a force-push and a shallow clone all produce a sha that isn't there, and treating that as
 * "nothing changed" publishes nothing and says it succeeded. */
function changedSince(sha, repoDir) {
  if (/^0+$/.test(sha)) return null;             // GitHub's "no before commit" sentinel
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${sha}`, '--'],
      { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch { return null; }
}

/* Drop the copied public/ files this deck never asks for.
 *
 * Slidev copies public/ wholesale into every build. public/ is 77MB of every topic's
 * figures, so a deck for 1.1.1 shipped 1.10.4's images and 59 decks shipped the same 77MB
 * 59 times - measured at 84MB and 861 objects for one deck, of which 6.4MB was the deck.
 * That, not the build time, was the reason a one-slide typo re-uploaded gigabytes.
 *
 * Done as a post-pass rather than by building each deck against a trimmed publicDir: it
 * needs no Slidev configuration, leaves `slidev dev` seeing the whole of public/ exactly as
 * before, and leaves every `/images/...` reference in the markdown untouched.
 *
 * Only paths that were copied *from* public/ are candidates. Everything Vite emitted itself
 * lives under assets/ with a content hash and is left alone - it is the deck.
 */
function pruneAssets(outDir, used) {
  const keep = new Set(used);
  let removed = 0, kept = 0, freed = 0;
  const roots = new Set(used.map(u => u.split('/')[1]).filter(Boolean));
  // Only walk the top-level directories the deck's own references point into - `images/`
  // here. Anything else public/ holds is left alone rather than guessed at.
  for (const root of roots) {
    const dir = path.join(outDir, root);
    if (!fs.existsSync(dir)) continue;
    walk(dir, file => {
      const ref = '/' + path.relative(outDir, file).split(path.sep).join('/');
      if (keep.has(ref)) { kept++; return; }
      freed += fs.statSync(file).size;
      fs.rmSync(file);
      removed++;
    });
    prunEmpty(dir);
  }
  return { removed, kept, freed };
}

function walk(dir, onFile) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function prunEmpty(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) prunEmpty(path.join(dir, e.name));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

/* A declaration, not `const mb = ...`. The command switch at the top of this file runs
 * before anything below it is evaluated, so a const here sits in the temporal dead zone and
 * throws the moment the first deck finishes building. */
function mb(bytes) { return `${(bytes / 1048576).toFixed(1)}MB`; }

function writeManifest(outRoot, built, all) {
  fs.mkdirSync(outRoot, { recursive: true });
  // Dot-prefixed and never copied to dist: build.mjs only carries directories that hold an
  // index.html, so this stays on the build machine where it belongs.
  fs.writeFileSync(path.join(outRoot, '.built.json'),
    JSON.stringify({ built, all }, null, 2));
}

async function cmdBundle() {
  const outDir = path.resolve(flag('out', 'dist'));
  // Its own staging directory, deliberately: building the content wipes and recreates it,
  // and a `dev` server serving the same path keeps the old handle and starts answering
  // every content request with the index page instead.
  const staging = path.join(contentDir, '..', '.icecore-bundle');
  await buildAll(staging);
  const { build } = await import('vite');
  await build({
    configFile: path.join(APP, 'vite.config.js'),
    root: APP,
    publicDir: staging,
    build: { outDir, emptyOutDir: true },
  });
  console.log(`\ndeployable site in ${path.relative(process.cwd(), outDir)}/`);
}
