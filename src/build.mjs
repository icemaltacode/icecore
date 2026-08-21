/* Turn a course's exercise markdown into publishable static content.
 *
 *   <contentDir>/exercises/<unit>/_unit.json   unit number + title
 *   <contentDir>/exercises/<unit>/NN-slug.md   one exercise each
 *   <contentDir>/data/<table>.sql              seed data
 *        ->
 *   <outDir>/content/courses.json              manifest
 *   <outDir>/content/<course>/index.json       units + exercises + expected results
 *   <outDir>/content/<course>/data/<t>.sql     datasets, fetched on demand
 *
 * Reference solutions ARE written to the output. Grading still compares against the
 * expected result sets computed here; the solution ships so the player can reveal it and
 * the hint service has something to reason about. See CLAUDE.md on why that's deliberate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { validate as validateDragDrop } from '../app/src/dragdrop.js';
import { EXTENSIONS } from './extensions.mjs';
import { slidesSrcDir, deckFiles, readDecks } from './decks.mjs';
import { openExpectedCache } from './expected-cache.mjs';
import { seedFor, packageKey } from '../app/src/python.js';
import { fileURLToPath } from 'node:url';

/* The grader's vendored wheels, beside the app that serves them. Absolute and derived
 * from this module: the builder runs from a course repo, never from here. */
const WHEEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'py');

// ---- markdown parsing ------------------------------------------------------
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, text];
  const fm = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (fm[key] ||= []).push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    fm[key] = kv[2] === '' ? [] : coerce(unquote(kv[2]));
  }
  return [fm, text.slice(m[0].length)];
}
const unquote = s => { const t = s.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) { try { return JSON.parse(t.replace(/^'|'$/g, '"')); } catch { return t.slice(1, -1); } }
  return t; };
const coerce = v => /^-?\d+$/.test(v) ? Number(v) : v;

function sections(md) {
  const out = [];
  let cur = { level: 0, title: null, body: [] };
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { out.push(cur); cur = { level: h[1].length, title: h[2].trim(), body: [] }; }
    else cur.body.push(line);
  }
  out.push(cur);
  return out.map(s => ({ ...s, body: s.body.join('\n').trim() }));
}
const codeIn = body => body.match(/```[a-z]*\n([\s\S]*?)```/)?.[1].replace(/\s+$/, '') ?? '';
/* Setup is SQL and only SQL. `## Setup` is already present in most shipped exercises
 * holding DataCamp's Python connect() line, which must never be executed - so this insists
 * on a ```sql fence rather than taking whatever code it finds. */
const sqlIn = body => body.match(/```sql\s*\n([\s\S]*?)```/)?.[1].replace(/\s+$/, '') ?? '';
/* Same insistence for Python. A module 2 exercise's `## Setup` is DataCamp's
 * pre-exercise code - it defines the dataframes the exercise talks about - and it has to be
 * a ```python fence rather than whatever code happens to be first. */
const pyIn = body => body.match(/```python\s*\n([\s\S]*?)```/)?.[1].replace(/\s+$/, '') ?? '';
const bullets = body => (body || '').split('\n')
  .filter(l => /^\s*[-*]\s+/.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '').trim());
const numbered = body => (body || '').split('\n')
  .filter(l => /^\s*\d+[.)]\s+/.test(l)).map(l => l.replace(/^\s*\d+[.)]\s+/, '').trim());

/* Item ids are derived from the item's own text so the JSON stays readable, with a
 * numeric suffix only where two items would otherwise collide.
 *
 * `used` is passed in for classify, so it spans every zone. Ids only have to be unique
 * within the exercise, not within a zone: grading matches a placement to an item by id, so
 * two zones each owning an "avg" would let an item dropped in the wrong zone grade as
 * correct in both. (`AVG()` and `AVG` slug identically, and their content differs, so
 * nothing else would catch it.) validate() still checks for duplicate ids as a backstop. */
function withIds(contents, used = new Map()) {
  return contents.map(content => {
    const base = content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item';
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { id: n === 1 ? base : `${base}-${n}`, content };
  });
}
const stripHeading = body => body.replace(/^#\s+.*$/m, '').trim();
/* `1. text  ← correct` - the same convention whether it's a whole exercise or one step. */
const optionsIn = body => {
  const lines = (body || '').split('\n').filter(l => /^\d+\.\s/.test(l));
  return {
    options: lines.map(l => l.replace(/^\d+\.\s*/, '').replace(/\s*←\s*correct\s*$/, '').trim()),
    answer: lines.findIndex(l => /←\s*correct\s*$/.test(l)),
  };
};
const orderedIn = body => (body || '').split('\n').filter(l => /^\d+\.\s/.test(l))
  .map(l => l.replace(/^\d+\.\s*/, '').trim());
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/* Dotted numbers sort numerically, not as text: 1.10 comes after 1.9, and exercise 10
 * after exercise 9. Plain .sort() gets both wrong the moment a unit reaches double figures. */
const byNumber = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
/** Every topic in a course, in order, flattened out of its modules and units. */
const topicsOf = course => (course.modules || []).flatMap(m => m.units.flatMap(u => u.topics));

export function parseExercise(file, text) {
  const [fm, md] = frontmatter(text);
  const secs = sections(md);
  const intro = stripHeading(secs[0].body);

  if (fm.type === 'mcq') {
    const { options, answer } = optionsIn(secs.find(s => s.title === 'Options')?.body);
    const feedback = orderedIn(secs.find(s => s.title === 'Feedback')?.body);
    // Every imported multiple-choice exercise carries a hint, and until now all of them
    // were dropped on the floor.
    const hint = secs.find(s => s.title === 'Hint')?.body || '';
    return { ...fm, file, prompt: intro, options, answer, feedback, hint };
  }

  if (fm.type === 'dragdrop') {
    const hint = secs.find(s => s.title === 'Hint')?.body || '';
    const instructions = secs.find(s => s.title === 'Instructions')?.body || '';
    if (fm.mode === 'order')
      return { ...fm, file, prompt: intro, instructions, hint,
               items: withIds(numbered(secs.find(s => s.title === 'Sequence')?.body)) };

    // Everything at level 3 after `## Zones` is a zone, until the next level-2 heading.
    const zones = [];
    const usedIds = new Map();   // shared across zones - see withIds
    let inZones = false;
    for (const sec of secs) {
      if (sec.level === 2) inZones = sec.title === 'Zones';
      else if (inZones && sec.level === 3)
        zones.push({ id: slug(sec.title), title: sec.title, items: withIds(bullets(sec.body), usedIds) });
    }
    return { ...fm, file, prompt: intro, instructions, hint, pool: fm.pool || 'Items', zones };
  }

  const setup = secs.find(s => s.title === 'Setup');
  const steps = [];
  let cur = null;
  for (const s of secs) {
    if (s.level === 2 && (/^Step \d+$/.test(s.title || '') || s.title === 'Instructions')) {
      // `kind` is settled below by which sections the step actually carries: a step with
      // `### Options` is multiple-choice, one with `### Solution` is a query. Both kinds
      // can sit in the same exercise, and an MCQ step still gets the dataset and the
      // editor - the student often has to look at the data to answer.
      cur = { kind: 'coding', instructions: s.body || '', sample: '', solution: '', hint: '' };
      steps.push(cur);
    } else if (cur && s.level === 3) {
      if (s.title === 'Sample') cur.sample = codeIn(s.body);
      else if (s.title === 'Solution') cur.solution = codeIn(s.body);
      else if (s.title === 'Hint') cur.hint = s.body;
      // Marks the step's result as unreproducible - see compare.js. The body is a note to
      // whoever reads the file later, not something the player shows.
      else if (s.title === 'Nondeterministic') cur.nondeterministic = s.body?.trim() || true;
      /* The step's SCT: a pythonwhat program, executed rather than interpreted. It is the
       * grader for a `type: python` step the way `### Solution` plus a precomputed result
       * set is the grader for a SQL one - see app/src/python.js. */
      else if (s.title === 'Check') cur.sct = codeIn(s.body);
      else if (s.title === 'Options') Object.assign(cur, { kind: 'mcq' }, optionsIn(s.body));
      else if (s.title === 'Feedback') cur.feedback = orderedIn(s.body);
    }
  }
  const setupBody = setup?.body || '';
  return { ...fm, file, prompt: intro, steps,
           setup: fm.type === 'python' ? pyIn(setupBody) : sqlIn(setupBody) };
}

/* Hand corrections, and the marker that proves one survived.
 *
 * Some imported exercises have to be fixed by hand - a library moved on, DataCamp's own
 * content was wrong - and `dc-convert --force` regenerates from `content/raw/` and wipes
 * every one of them. Silently. It has already happened: a forced re-convert an hour after
 * the corrections were written undid one, and it was noticed only because someone went
 * looking.
 *
 * The same standing hazard as `### Nondeterministic` and `section:`, and until now the only
 * one without a check. A list in a file is worth exactly as much as the next person opening
 * it.
 *
 * So: `content/corrections/README.md` says WHICH exercises were corrected and why, and each
 * of those carries `corrected:` in its frontmatter. The list is the record and the marker is
 * the evidence, and the check fires when the marker is ABSENT - because absence is the
 * failure. A forced re-convert drops the frontmatter key along with the fix, so the file
 * stops matching its own record and verify says so.
 *
 * Parsed out of the register's headings rather than from a second machine-readable file,
 * which would be one more thing to drift:
 *
 *   ## 2.8.2 `09-weighted-sampling.md`
 *   ## 2.9.2 `11-using-ttest.md`, 2.9.4 `06`, `08`, `09` - pingouin column names
 *
 * A backticked value ending in .md is a filename; a bare number is a prefix resolved against
 * that topic's files. A topic carries forward to the backticks after it, which is what makes
 * the second line mean four exercises across two topics.
 */
export function correctionRegister(contentDir) {
  const file = path.join(contentDir, 'corrections', 'README.md');
  const out = [];
  if (!fs.existsSync(file)) return out;
  const exDir = path.join(contentDir, 'exercises');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('## ')) continue;
    let topic = null;
    // Topics and backticked names in the order they appear, so a name binds to the topic
    // most recently named to its left.
    for (const m of line.matchAll(/(\d+(?:\.\d+)+)|`([^`]+)`/g)) {
      if (m[1]) { topic = m[1]; continue; }
      if (!topic) continue;
      const value = m[2].trim();
      const dir = path.join(exDir, topic);
      const names = !fs.existsSync(dir) ? []
        : value.endsWith('.md') ? [value]
        : fs.readdirSync(dir).filter(f => f.endsWith('.md') && f.startsWith(value));
      if (!names.length) { out.push({ topic, file: value, missing: true }); continue; }
      for (const name of names)
        out.push({ topic, file: name, missing: !fs.existsSync(path.join(dir, name)) });
    }
  }
  return out;
}

const isDDL = q => /\b(create|drop|alter|insert|update|delete|truncate)\b/i.test(q);

/* Calls whose result depends on when the query runs. Split in two because some are
 * functions and some are bare keywords, and a bare \b(now)\b would match a column called
 * `now`. Used only to insist the step is *marked* - it never changes grading by itself. */
const VOLATILE = [
  /\b(now|random|clock_timestamp|timeofday|statement_timestamp)\s*\(/i,
  /\b(current_date|current_time|current_timestamp|localtime|localtimestamp)\b/i,
];
const volatileCall = sql => {
  const m = VOLATILE.map(re => sql.match(re)).find(Boolean);
  if (!m) return null;
  // The function form's match ends at the opening paren; the keyword form has none.
  return m[0].trim().endsWith('(') ? `${m[1].toLowerCase()}()` : m[0].toUpperCase();
};

/**
 * Every step must be exactly one kind. A step carrying neither a Solution nor Options is
 * dead weight the player can't present; one carrying both is ambiguous. Exercise 07 of
 * 1.3.1 shipped a silently-dropped question because nothing checked per step.
 */
export function stepProblems(ex) {
  const problems = [];
  if (!ex.steps?.length) return ['no steps parsed'];
  for (const [i, step] of ex.steps.entries()) {
    const where = ex.steps.length > 1 ? `step ${i + 1}` : 'the instructions';
    const coding = !!step.solution, mcq = !!step.options?.length;
    if (coding && mcq) problems.push(`${where} has both a Solution and Options`);
    else if (!coding && !mcq) problems.push(`${where} has neither a Solution nor Options`);
    else if (mcq && !(step.answer >= 0)) problems.push(`${where} has no correct option marked`);

    /* A Python step is graded by its own SCT and by nothing else. There is no result set to
     * fall back on, so a step that lost its `### Check` would not fail - it would accept
     * every submission, silently, which is worse than rejecting every one. Same standing
     * hazard as a dropped `### Nondeterministic`: the SCT comes from the capture and a
     * forced re-convert can drop it. */
    if (ex.type === 'python' && coding && !step.sct)
      problems.push(`${where} has a Solution but no "### Check" - a Python step with no SCT `
        + 'accepts every submission');

    // Expected values are computed at build time, so a volatile call means the step either
    // fails immediately or - worse - passes today and fails at midnight. The marker is
    // hand-written in the exercise, so a re-convert can wipe it; without this check that
    // would quietly restore strict grading and surface later as a data problem.
    // SQL only: a Python step has no precomputed values to go stale, because it is graded
    // live against its SCT rather than against anything recorded at build time.
    const volatile = ex.type !== 'python'
      && coding && !step.nondeterministic && volatileCall(step.solution);
    if (volatile)
      problems.push(`${where} uses ${volatile} but is not marked "### Nondeterministic" - `
        + 'its expected values cannot be reproduced');
  }
  return problems;
}

/**
 * Build a content directory. Returns the full model, which is also what gets written.
 */
export async function buildContent({ contentDir, outDir, write = true, log = console.log,
                                     slidesSrc = null, writeManifest = true }) {
  /* A course with no exercises is legitimate, not an empty checkout. An announced course -
   * one with a card on the grid and nothing behind it yet - is exactly a course.json and a
   * cover, and it has to build so it can publish. The player renders a course with nothing
   * gradable in it as announced rather than as broken. */
  const exDir = path.join(contentDir, 'exercises');

  // ---- collect topics, and hang them off the course's modules and units ----
  //
  //   Course   the whole programme, one per content repo   ICExDataCamp Data Analyst
  //   Module   a DataCamp track                            1
  //   Unit     a DataCamp course                           1.1
  //   Topic    a DataCamp chapter                          1.1.1
  //
  // Only the topic is a directory. Its unit is declared in _topic.json and its module is
  // the unit number's first component, so nothing has to be stated twice.
  const courseFile = path.join(contentDir, 'course.json');
  if (!fs.existsSync(courseFile))
    throw new Error(`No course.json in ${contentDir} - it declares the course and its modules`);
  const courseMeta = JSON.parse(fs.readFileSync(courseFile, 'utf8'));
  if (!courseMeta.id || !courseMeta.title) throw new Error('course.json needs an id and a title');

  const warnings = [];
  const usedImages = new Set();   // "<topic>/<file>", so unreferenced files aren't shipped
  const missingImages = [];       // verify fails on these - a dropped figure is the bug
  const usedApps = new Set();     // "<topic>/<name>", same idea for embedded apps
  const missingApps = [];
  const missingChecks = [];   // a Python step with no SCT grades nothing
  const missingCorrections = [];  // a hand fix a forced re-convert has wiped
  const moduleTitles = new Map((courseMeta.modules || []).map(m => [String(m.module), m.title]));
  // The card image for the course grid. Named in course.json and resolved beside it, the
  // same way an exercise's figures are resolved beside the exercise - a course shouldn't
  // have to know where the bundle is mounted either. Optional: without one the player
  // draws a tile instead, which is why a *missing* file is an error and an absent field
  // is not. Square: the grid crops to 1:1 and a wide image loses its edges.
  const course = {
    id: courseMeta.id, title: courseMeta.title, modules: [],
    blurb: courseMeta.blurb, image: courseMeta.image,
  };
  const unitOf = new Map();     // "1.1" -> the unit object, so topics find their home

  const topicDirs = fs.existsSync(exDir)
    ? fs.readdirSync(exDir).filter(d => /^\d/.test(d)).sort(byNumber) : [];
  for (const topicId of topicDirs) {
    const dir = path.join(exDir, topicId);
    const metaFile = path.join(dir, '_topic.json');
    if (!fs.existsSync(metaFile)) { warnings.push(`${topicId}: no _topic.json - skipped`); continue; }
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!meta.unit) { warnings.push(`${topicId}: _topic.json has no unit - skipped`); continue; }

    // An exercise's figures live beside it. Referenced by bare filename: the markdown has
    // no business knowing the course id or where the bundle is mounted.
    const imgDir = path.join(dir, 'images');
    const haveImages = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);

    // An embedded app is a static bundle mirrored beside the exercise that uses it. It has
    // to bring its own index.html: that is what the iframe loads.
    const appDir = path.join(dir, 'apps');
    const haveApps = new Set((fs.existsSync(appDir) ? fs.readdirSync(appDir) : [])
      .filter(a => fs.existsSync(path.join(appDir, a, 'index.html'))));

    const exercises = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(byNumber)
      .map(f => {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        // The whole point of this feature is that figures were being dropped in silence,
        // so a reference with no file behind it is worth saying out loud.
        for (const [, src] of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
          if (/^(https?:)?\/\//.test(src) || src.startsWith('/')) continue;
          if (!haveImages.has(src)) missingImages.push(`${topicId} ${f}: no image at images/${src}`);
          else usedImages.add(`${topicId}/${src}`);
        }
        for (const [, name] of text.matchAll(/^\s*::app\s+([\w.-]+)(?:\s+height=\d+)?\s*::\s*$/gm)) {
          if (!haveApps.has(name)) missingApps.push(`${topicId} ${f}: no app at apps/${name}/index.html`);
          else usedApps.add(`${topicId}/${name}`);
        }
        return parseExercise(f, text);
      });

    for (const e of exercises.filter(e => e.type === 'coding'))
      for (const problem of stepProblems(e)) warnings.push(`${topicId} ${e.file}: ${problem}`);
    for (const e of exercises.filter(e => e.type === 'mcq' && !(e.answer >= 0)))
      warnings.push(`${topicId}: no correct option in ${e.file}`);
    for (const e of exercises.filter(e => e.type === 'dragdrop'))
      for (const problem of validateDragDrop(e)) warnings.push(`${topicId} ${e.file}: ${problem}`);

    const moduleId = String(meta.unit).split('.')[0];
    let mod = course.modules.find(m => m.module === moduleId);
    if (!mod) {
      if (!moduleTitles.has(moduleId)) warnings.push(`module ${moduleId} has no title in course.json`);
      mod = { module: moduleId, title: moduleTitles.get(moduleId) || `Module ${moduleId}`, units: [] };
      course.modules.push(mod);
    }

    let unit = unitOf.get(meta.unit);
    if (!unit) {
      unit = { unit: meta.unit, title: meta.unitTitle || meta.unit, label: `${meta.unit} - ${meta.unitTitle || meta.unit}`, topics: [] };
      unitOf.set(meta.unit, unit);
      mod.units.push(unit);
    } else if (meta.unitTitle && meta.unitTitle !== unit.title) {
      warnings.push(`${topicId}: unitTitle "${meta.unitTitle}" disagrees with "${unit.title}" used by earlier topics of ${meta.unit}`);
    }

    unit.topics.push({
      topic: meta.topic || topicId, title: meta.title,
      label: `${meta.topic || topicId} - ${meta.title}`,
      slides: meta.slides, exercises,
    });
  }
  course.modules.sort((a, b) => byNumber(a.module, b.module));
  for (const m of course.modules) {
    m.units.sort((a, b) => byNumber(a.unit, b.unit));
    for (const u of m.units) u.topics.sort((a, b) => byNumber(a.topic, b.topic));
  }
  if (course.image && !fs.existsSync(path.join(contentDir, course.image)))
    missingImages.push(`course.json: no image at ${course.image}`);
  const courses = new Map([[course.id, course]]);

  // ---- discover slide decks ----
  //
  // A topic has a deck when the course repo has a *source* deck for it, at
  // slides/topic-<topic>.md. Deliberately not "when a deck has been built to
  // content/slides/<topic>/": that coupled the content pipeline to the deck pipeline, so
  // publishing without rebuilding every deck first quietly shipped a course with no slides
  // links at all. Source is the thing that is true regardless of what any given CI run
  // chose to rebuild - which is what makes selective deck building safe.
  //
  // Still derived rather than declared: a `slides:` key in _topic.json would be a second
  // source of truth that could disagree with the repo. `slides:` may still be set to an
  // absolute URL when a deck lives somewhere else entirely.
  const slidesDir = path.join(contentDir, 'slides');       // build output, copied to dist
  const srcDir = slidesSrc || slidesSrcDir(contentDir);    // authored decks
  const sources = deckFiles(srcDir);
  const built = new Set(fs.existsSync(slidesDir)
    ? fs.readdirSync(slidesDir).filter(d => fs.existsSync(path.join(slidesDir, d, 'index.html')))
    : []);
  for (const d of fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir) : [])
    if (!built.has(d) && fs.statSync(path.join(slidesDir, d)).isDirectory())
      warnings.push(`${d}: slides/${d}/ has no index.html - half-built deck`);

  // Sections come from the source decks too, and for the same reason: a selective build
  // leaves most of content/slides/ untouched, so anything read from there is stale by
  // design. Parsing is ~300ms for 59 decks and buys one source of truth.
  const deckErrors = [];
  const decks = await readDecks(srcDir, {
    onError: (topic, msg) => deckErrors.push(`${topic}: deck will not parse - ${msg}`),
  });
  warnings.push(...deckErrors);
  // Said out loud because the alternative is a course that quietly stops interleaving. The
  // parser lives in the course's slides/, so `npm ci` there is a prerequisite of building
  // content - not just of building decks, which is the intuition that gets this wrong.
  if (sources.size && !decks.size)
    warnings.push(`${sources.size} deck source(s) but @slidev/parser could not be loaded `
      + `from ${srcDir} - no topic will interleave. Run npm ci there.`);

  const missingSections = [];   // verify fails on these - see below
  for (const course of courses.values())
    for (const u of topicsOf(course)) {
      // index.html is named explicitly rather than relying on a directory index: S3 behind
      // CloudFront only applies defaultRootObject to the root, so `slides/1.2.3/` would
      // 404 in production, and a dev server answers it with the app's own index page -
      // which then loads the whole player inside the iframe.
      if (!u.slides && sources.has(u.topic)) u.slides = `slides/${u.topic}/index.html`;

      /* Interleaving. A section is an annotation on a run of exercises within a topic - a
       * label and a slide range - not a level of the hierarchy that owns them. Topics still
       * hold the exercises; `section:` just groups them. That keeps "only topics are
       * directories, only topics hold exercises" true, and keeps the vocabulary at four
       * words. The ordinal is internal and never shown to a student.
       *
       * A topic with no `section:` on anything simply doesn't interleave, which is how a
       * course with no raw data behaves and how every course behaved before this. */
      const sections = decks.get(u.topic)?.sections;
      const numbered = u.exercises.filter(e => e.section != null);
      if (!numbered.length) continue;
      if (!sections?.length) {
        missingSections.push(`${u.topic}: exercises carry section: but the deck has no `
          + '"layout: statement" sections (or there is no deck)');
        continue;
      }
      // A section pointing past the end of the deck is the failure this exists to catch:
      // the prompt still reads fine, the exercise still grades, and the slide link lands on
      // nothing. Same treatment as a missing figure.
      for (const e of numbered)
        if (!(e.section >= 1 && e.section <= sections.length))
          missingSections.push(`${u.topic} ${e.file}: section ${e.section} does not exist `
            + `- the deck has ${sections.length}`);
      if (numbered.length !== u.exercises.length)
        warnings.push(`${u.topic}: ${u.exercises.length - numbered.length} of `
          + `${u.exercises.length} exercises have no section: - the topic won't interleave`);
      // Carried only when every exercise is placed: a partial mapping interleaves some of
      // the topic and silently drops the rest, which reads as lost exercises.
      // `slideCount` is the COMPOSED deck's length - what Slidev's own paginator counts
      // against - so the player can label a section in the same numbers the student is
      // looking at inside the frame.
      else { u.sections = sections; u.slideCount = decks.get(u.topic).slides; }
    }

  // ---- load datasets ----
  // A dataset is either one <name>.sql, or a <name>/ directory of per-table .sql files
  // concatenated in filename order -- a dataset is a database, and a database may hold
  // more than one table. Either way it ships as a single <name>.sql, so the player only
  // ever fetches one file per dataset.
  /* `content/data/` holds two unrelated kinds of thing and the difference is NOT file
   * versus directory - both kinds can be directories:
   *
   *   books.sql     a SQL dataset, one file
   *   films/        a SQL dataset, a directory of .sql concatenated in filename order
   *   2.4/          Python data files, mounted verbatim into the interpreter
   *
   * What separates them is the NAME. A Python data directory is named for its unit, and a
   * unit number is not something anyone would call a dataset. Sniffing the contents instead
   * would work today and quietly reclassify a unit the day someone drops a .sql in it.
   *
   * Said out loud in the log rather than decided silently, because getting this wrong makes
   * a dataset vanish - and a missing dataset surfaces much later, as an exercise reporting
   * that a table does not exist. */
  const UNIT_DIR = /^\d+\.\d+$/;
  const dataDir = path.join(contentDir, 'data');
  const datasets = {};
  const pyUnits = [];
  for (const e of (fs.existsSync(dataDir) ? fs.readdirSync(dataDir, { withFileTypes: true }) : [])) {
    if (e.isDirectory()) {
      const dir = path.join(dataDir, e.name);
      const sqlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
      if (UNIT_DIR.test(e.name)) {
        pyUnits.push(e.name);
        if (sqlFiles.length)
          warnings.push(`data/${e.name}/ is named for a unit, so it is Python data - but it `
            + `holds ${sqlFiles.length} .sql file(s), which will not be loaded as a dataset`);
        continue;
      }
      if (sqlFiles.length)
        datasets[e.name] = sqlFiles.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
      else
        warnings.push(`data/${e.name}/ has no .sql in it and is not named for a unit - ignored`);
    } else if (e.name.endsWith('.sql')) {
      datasets[e.name.replace(/\.sql$/, '')] = fs.readFileSync(path.join(dataDir, e.name), 'utf8');
    }
  }
  if (pyUnits.length)
    log(`  data: ${Object.keys(datasets).length} SQL dataset(s), `
        + `Python files for unit(s) [${pyUnits.sort(byNumber).join(', ')}]`);

  // ---- precompute expected results ----
  //
  // Reference solutions are run here rather than in the browser, because booting PGlite
  // costs seconds and a check has to be instant. `expected-cache.mjs` then keeps the
  // results between builds: without it every `icecore dev` restart re-runs all of this, and
  // a one-line copy edit costs four minutes.
  const cache = openExpectedCache({ contentDir, extensions: Object.keys(EXTENSIONS), log });

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

  const withSetup = async (dump, setup) => {
    const db = new PGlite({ loadDataDir: dump, extensions: EXTENSIONS });
    try {
      await db.exec(setup);
      return await db.dumpDataDir();
    } finally { await db.close(); }
  };

  let computed = 0, failed = 0, validated = 0;

  /* The single place an outcome becomes warnings, counters and `step.expected` - reached
   * identically whether it was just computed or replayed off disk. Two code paths here is
   * exactly how a cached build starts quietly reporting different numbers from a cold one,
   * which would make the cache impossible to trust. */
  const record = (u, ex, outcome, validateOnly = false) => {
    if (outcome.setupError) {
      warnings.push(`${u.topic} ${ex.file}: setup failed - ${outcome.setupError}`);
      failed++;
      return;
    }
    (ex.steps || []).forEach((step, i) => {
      const r = outcome.steps[i];
      if (!r) return;                                  // a step with no solution to run
      if (r.error) {
        warnings.push(`${u.topic} ${ex.file}: solution failed - ${r.error}`);
        failed++;
      } else if (validateOnly) {
        // A Python step carries no expected values - it is graded live against its SCT -
        // so there is nothing to hang on the step. All this pass produces is the knowledge
        // that the reference solution passes its own check, and a count to say so.
        validated++;
      } else {
        step.expected = r.expected;
        computed++;
      }
    });
  };

  for (const course of courses.values()) {
    for (const u of topicsOf(course)) {
      for (const ex of u.exercises) {
        if (ex.type !== 'coding' || !ex.dataset) continue;
        if (!datasets[ex.dataset]) { warnings.push(`${u.topic} ${ex.file}: dataset "${ex.dataset}" not extracted yet`); continue; }

        const key = cache.keyFor(datasets[ex.dataset], ex.setup, ex.steps || []);
        const hit = cache.get(key);
        if (hit) { record(u, ex, hit); continue; }

        /* Everything below is the cache MISS path, and nothing above it touches a
         * database - which is the whole point. On a fully warm cache no PGlite instance is
         * booted at all, rather than booting one and asking it less. */
        const outcome = { setupError: null, steps: [] };
        // An exercise's setup SQL builds the derived tables it needs on top of the
        // dataset. Applied once, to a copy, and dumped: every step then starts from a
        // database that already has them, and only exercises declaring setup pay for it.
        let dump = await template(ex.dataset);
        if (ex.setup) {
          try {
            dump = await withSetup(dump, ex.setup);
          } catch (e) {
            outcome.setupError = String(e.message).split('\n')[0];
          }
        }
        if (!outcome.setupError) {
          let shared = null;   // SELECT-only solutions share a database; DDL needs a clean one
          for (const step of ex.steps || []) {
            // Held as a null rather than skipped: `record` reads the array positionally
            // against ex.steps, so dropping an entry would shift every later result onto
            // the wrong step.
            if (!step.solution) { outcome.steps.push(null); continue; }
            const fresh = isDDL(step.solution);
            const db = fresh
              ? new PGlite({ loadDataDir: dump, extensions: EXTENSIONS })
              : (shared ||= new PGlite({ loadDataDir: dump, extensions: EXTENSIONS }));
            try {
              const res = await db.exec(step.solution);
              const last = res[res.length - 1];
              outcome.steps.push({ expected: {
                fields: (last?.fields || []).map(f => f.name),
                // Values are deliberately not carried for a non-deterministic step: they
                // would be compared against nothing and only mislead anyone reading the JSON.
                rows: step.nondeterministic ? [] : (last?.rows || []).slice(0, 1000),
                rowCount: last?.rows?.length ?? 0,
                ordered: /\border\s+by\b/i.test(step.solution),
                nondeterministic: !!step.nondeterministic,
                ddl: fresh,
              } });
            } catch (e) {
              outcome.steps.push({ error: String(e.message).split('\n')[0] });
            } finally { if (fresh) await db.close(); }
          }
          await shared?.close();
        }
        cache.put(key, outcome);
        record(u, ex, outcome);
      }
    }
  }

  // ---- hand corrections still in place ----
  //
  // See `correctionRegister`. The register says which exercises were fixed by hand; the
  // `corrected:` frontmatter key on each is the evidence that the fix is still there. A
  // forced re-convert takes both the fix and the marker, so the file stops matching its own
  // record - which is the only way to notice, short of remembering.
  {
    const marked = new Set();
    for (const course of courses.values())
      for (const t of topicsOf(course))
        for (const ex of t.exercises)
          if (ex.corrected?.length) marked.add(`${t.topic}/${ex.file}`);

    for (const entry of correctionRegister(contentDir)) {
      const id = `${entry.topic}/${entry.file}`;
      if (entry.missing)
        missingCorrections.push(`${id}: named in content/corrections/README.md, but there is `
          + 'no such exercise');
      else if (!marked.delete(id))
        missingCorrections.push(`${id}: recorded as hand-corrected but carries no `
          + '`corrected:` - either a forced re-convert has wiped the fix, or the marker was '
          + 'never added');
    }
    // The other direction is a warning, not a failure: a marker with no entry means the
    // register was not updated, which loses the reason but not the fix.
    for (const id of marked)
      warnings.push(`${id}: carries \`corrected:\` but is not in content/corrections/README.md`);
  }

  // ---- validate Python solutions ----
  //
  // The Python analogue of precomputing expected results, and deliberately not the same
  // shape. A SQL step is graded against values recorded here; a Python step is graded live
  // in the browser by its own SCT, because the interpreter is already up and a check costs
  // ~20ms. So there is nothing to record - what this pass does is CHECK, by grading every
  // reference solution against its own SCT exactly as the player will.
  //
  // Worth having for the same reason `verify` is: a capture that dropped an SCT, or a
  // re-convert that mangled one, produces an exercise that accepts everything. That fails
  // here instead of in front of a student.
  const python = [];
  for (const course of courses.values())
    for (const u of topicsOf(course))
      for (const ex of u.exercises) {
        /* A `coding` exercise with no dataset and no SCT cannot be graded by anything.
         * The SQL pass skips it for want of a dataset and the Python pass never sees it,
         * so it builds, ships, and presents a student with a Check button that marks
         * nothing. Module 2 landed as 317 of exactly this - `type: coding` where it meant
         * `type: python` - and the only symptom was a missing line in the build log.
         * Module 1 has none, so the shape is unambiguous. */
        if (ex.type === 'coding' && !ex.dataset
            && (ex.steps || []).some(st => st.solution && !st.sct))
          missingChecks.push(`${u.topic} ${ex.file}: type: coding with no dataset: and no `
            + '"### Check" - nothing can grade it. Python exercises need type: python');
        if (ex.type !== 'python') continue;
        /* A Python step graded by nothing accepts everything. `stepProblems` says so too,
         * but that only runs under `verify` - and this is the one failure that gets WORSE
         * the later it is found, because the exercise builds, ships, and marks every
         * submission correct. Caught here so a build cannot produce it at all. */
        for (const [i, st] of (ex.steps || []).entries())
          if (st.solution && !st.sct)
            missingChecks.push(`${u.topic} ${ex.file}: ${ex.steps.length > 1 ? `step ${i + 1}` : 'the instructions'}`
              + ' has a Solution but no "### Check" - it would accept every submission');
        if ((ex.steps || []).some(st => st.solution && st.sct)) python.push({ u, ex });
      }

  if (python.length) {
    /* Imported here and not at the top: Pyodide is tens of megabytes of wasm and a course
     * with no Python exercises must not pay for it. The grader itself comes from the app,
     * the same way compare.js does, so the builder and the player cannot disagree about
     * what "correct" means. */
    /* Booted on the first cache MISS and not before. Pyodide plus pandas, matplotlib and
     * seaborn is ~5 seconds, and a warm build has nothing for it to do - the same reason
     * the SQL pass reaches `template()` only after the cache has been asked. A course
     * whose Python is all unchanged should not pay to start an interpreter that then
     * grades nothing.
     *
     * One interpreter for the whole build, loaded with the union of what the course needs:
     * loading a package twice is free, so per-exercise instances buy only wall-clock. */
    /* One interpreter per package SET, not one for the course. Loading the union is the
     * obvious implementation and is exactly what broke unit 2.4 - see `packageKey`.
     *
     * Built on the first cache miss for that set and not before, so a warm build starts
     * nothing. Only one is alive at a time: the exercises are walked grouped by set, so a
     * given interpreter serves all of its own and is then dropped. */
    let grader = null, graderKey = null, pyodide = null;
    const graderFor = async ex => {
      const key = packageKey(ex);
      if (grader && graderKey === key) return grader;
      const { loadPyodide } = await import('pyodide');
      const { createGrader } = await import('../app/src/python.js');
      pyodide = await loadPyodide();
      mounted.clear();                    // a new interpreter has an empty filesystem
      grader = await createGrader({
        pyodide,
        packages: ex.packages || [],
        wheels: ex.wheels || [],
        readWheel: name => fs.promises.readFile(path.join(WHEEL_DIR, name)),
      });
      graderKey = key;
      return grader;
    };

    /* A unit's data files, mounted where the exercise expects to find them. `data:` on an
     * exercise names files under `content/data/<unit>/`, and the exercise refers to them by
     * bare filename - it should no more know the course id than a figure does.
     *
     * Per unit rather than per topic because the files are shared within one: 2.4's
     * casts.p is 8.6MB and duplicating it per topic is the deck-images mistake. Checked by
     * the ripper across all 82 (unit, filename) pairs - no filename means two different
     * things inside one unit. */
    /* A topic knows its own number and the numbering IS the hierarchy - `2.6.1` is topic 1
     * of unit 2.6 of module 2 - so the unit is the first two components and never needs
     * storing twice. Course > Module > Unit > Topic, numbered 1 / 1.1 / 1.1.1. */
    const unitOf = topic => String(topic).split('.').slice(0, 2).join('.');

    const mounted = new Set();
    const mount = unit => {
      const dir = path.join(contentDir, 'data', unit);
      const at = `/ice-data/${unit}`;
      if (mounted.has(unit)) return at;
      mounted.add(unit);
      pyodide.FS.mkdirTree(at);
      for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []))
        if (fs.statSync(path.join(dir, f)).isFile())
          pyodide.FS.writeFile(`${at}/${f}`, fs.readFileSync(path.join(dir, f)));
      return at;
    };

    // Grouped, so each set's interpreter is built once rather than once per switch.
    python.sort((a, b) => packageKey(a.ex).localeCompare(packageKey(b.ex)));
    for (const { u, ex } of python) {
      // A declared file that isn't there is the failure this exists to catch: the exercise
      // reads fine, the SCT is intact, and the student gets a FileNotFoundError.
      const unit = unitOf(u.topic);
      const dir = path.join(contentDir, 'data', unit);
      for (const f of ex.data || [])
        if (!fs.existsSync(path.join(dir, f)))
          missingImages.push(`${u.topic} ${ex.file}: no data file at data/${unit}/${f}`);

      /* Where a SQL exercise puts its dataset, a Python one puts everything else that
       * decides the answer: the package set and the seed. Both are the state the run starts
       * from, and both change the result without changing a character of the exercise.
       *
       * The packages were missing here and it cost an hour of looking in the wrong place.
       * 2.7.3 needed scipy added to its manifest; the fix landed, the key did not move, and
       * the build cheerfully replayed the cached failure from before the fix. The converter
       * had done its job and the evidence said otherwise. */
      const key = cache.keyFor(`${packageKey(ex)}\n${seedFor(ex)}`, ex.setup, ex.steps || []);
      const hit = cache.get(key);
      if (hit) { record(u, ex, hit, true); continue; }

      const g = await graderFor(ex);
      const cwd = mount(unit);
      const outcome = { setupError: null, steps: [] };
      for (const step of ex.steps || []) {
        if (!step.solution || !step.sct) { outcome.steps.push(null); continue; }
        try {
          const r = await g.grade({ pec: ex.setup, solution: step.solution,
                                         submission: step.solution, sct: step.sct, cwd,
                                         seed: seedFor(ex) });
          outcome.steps.push(r.correct
            ? { expected: { python: true } }
            : { error: `the reference solution does not satisfy its own SCT - ${
                  String(r.message || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)}` });
        } catch (e) {
          /* Last line, not first: a pythonwhat failure arrives as a Python traceback and
           * the first line is always "Traceback (most recent call last):". The bottom line
           * carries the exception and its message, which is the part that says what the
           * solution actually did wrong. */
          const lines = String(e.message).trim().split('\n').filter(Boolean);
          outcome.steps.push({ error: `SCT raised - ${(lines[lines.length - 1] || '').trim().slice(0, 200)}` });
        }
      }
      cache.put(key, outcome);
      record(u, ex, outcome, true);
    }
    log(`  validated ${validated} Python solution${validated === 1 ? '' : 's'} against their own SCTs`);
  }

  /* Swept LAST, after every pass that asks the cache for a key. `get()` is what registers a
   * key as live, so sweeping between the SQL pass and the Python one deleted every Python
   * entry before it had been claimed - a cache that hit exactly never, and a warm build
   * that still paid five seconds to boot an interpreter with nothing to do. */
  cache.sweep();

  // ---- emit ----
  const manifest = [];
  if (write) {
    const contentOut = path.join(outDir, 'content');
    fs.mkdirSync(contentOut, { recursive: true });

    for (const course of courses.values()) {
      /* Scoped to this course's own directory. It used to clear the whole of content/,
       * which is fine while a site is one course and silently deletes the others the
       * moment it isn't - the same shape of bug as an `s3 sync --delete` against the
       * content prefix, and fixed the same way: a build owns `content/<id>/` and the
       * catalogue, and nothing else. */
      const dir = path.join(contentOut, course.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

      const used = new Set(topicsOf(course).flatMap(t => t.exercises.map(e => e.dataset)).filter(Boolean));
      const shipped = [];
      for (const d of used) {
        if (!datasets[d]) continue;
        fs.writeFileSync(path.join(dir, 'data', `${d}.sql`), datasets[d]);
        shipped.push(d);
      }

      /* A unit's Python data files, shipped beside the SQL datasets under the same `data/`
       * prefix - one is `<name>.sql`, the other a `<unit>/` directory, and a file cannot
       * collide with a directory.
       *
       * Only what an exercise actually DECLARES is copied. A unit directory can hold more
       * than the course uses, and shipping the rest is the same waste as a deck carrying
       * every topic's figures - except here a stray file is megabytes of pickle. */
      let pyFiles = 0;
      for (const t of topicsOf(course))
        for (const ex of t.exercises) {
          if (ex.type !== 'python' || !(ex.data || []).length) continue;
          const unit = String(t.topic).split('.').slice(0, 2).join('.');
          for (const name of ex.data) {
            const from = path.join(contentDir, 'data', unit, name);
            if (!fs.existsSync(from)) continue;      // already reported by the check above
            const to = path.join(dir, 'data', unit, name);
            if (fs.existsSync(to)) continue;         // shared across topics within the unit
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
            pyFiles++;
          }
        }

      // Under content/, deliberately: that path is already behind the CloudFront key group
      // and already carried by the content sync, so figures inherit both for free.
      let images = 0;
      for (const ref of usedImages) {
        const [topicId, file] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)];
        const from = path.join(exDir, topicId, 'images', file);
        if (!fs.existsSync(from)) continue;
        const to = path.join(dir, 'images', topicId, file);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        images++;
      }

      // Whole directories, not single files: an app is a shell plus its own assets.
      let apps = 0;
      for (const ref of usedApps) {
        const [topicId, name] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)];
        const from = path.join(exDir, topicId, 'apps', name);
        if (!fs.existsSync(from)) continue;
        fs.cpSync(from, path.join(dir, 'apps', topicId, name), { recursive: true });
        apps++;
      }

      // Published beside the course's other assets, so it inherits the content sync and
      // the CloudFront key group without anything else knowing about it.
      let cover = null;
      if (course.image) {
        const from = path.join(contentDir, course.image);
        if (fs.existsSync(from)) {
          cover = `cover${path.extname(course.image)}`;
          fs.copyFileSync(from, path.join(dir, cover));
        }
      }

      // `image` deliberately does not go into index.json: on the course object it is the
      // source filename, and a field of the same name in the manifest is the published
      // path. One name, two meanings, is how a wrong <img src> gets shipped.
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
        ...course, image: undefined,
        datasets: shipped,
      }));

      const topics = topicsOf(course);
      const all = topics.flatMap(t => t.exercises);
      const units = course.modules.flatMap(m => m.units);
      manifest.push({
        id: course.id, title: course.title, blurb: course.blurb,
        // Relative to the content root, which is the only path the player knows.
        image: cover && `${course.id}/${cover}`,
        modules: course.modules.map(m => ({
          module: m.module, title: m.title,
          units: m.units.map(u => ({ unit: u.unit, title: u.title, label: u.label })),
        })),
        exercises: all.length,
        coding: all.filter(e => e.type === 'coding').length,
        mcq: all.filter(e => e.type === 'mcq').length,
      });
      log(`  ${course.id}: ${course.modules.length} module${course.modules.length === 1 ? '' : 's'}, ` +
          `${units.length} units, ${topics.length} topics, ${all.length} exercises, ` +
          `${images} image${images === 1 ? '' : 's'}, ${apps} app${apps === 1 ? '' : 's'}, ` +
          `${pyFiles ? `${pyFiles} data file${pyFiles === 1 ? '' : 's'}, ` : ''}` +
          `datasets [${shipped.join(', ') || 'none'}]`);
    }
    /* Each course also publishes its own catalogue entry beside its content.
     *
     * `courses.json` is the whole site's list and no single course owns it - two courses
     * publishing from two repos would otherwise each overwrite it with a one-entry list,
     * and whichever ran last would be the only course the grid could see. So the entry is
     * published per course, at a path that course does own, and the catalogue is assembled
     * from all of them. That makes it self-healing: a course whose prefix is gone drops out
     * of the list without anyone remembering to edit it. */
    for (const entry of manifest)
      fs.writeFileSync(path.join(contentOut, entry.id, 'card.json'), JSON.stringify(entry, null, 2));
    // Written here only when this build is the whole site - a multi-course build merges the
    // manifests itself, and the publish pipeline rebuilds it from every card.json.
    if (writeManifest)
      fs.writeFileSync(path.join(contentOut, 'courses.json'), JSON.stringify(manifest, null, 2));

    // Decks sit at the site root, not under content/: a built Slidev deck is a small site
    // of its own with absolute asset paths, and its --base has to match where it lands.
    //
    // What lands here is whatever has actually been *built*, not every deck the course has
    // a source for. Under selective building that is only the decks this push rebuilt, and
    // the publish step syncs them one prefix at a time for exactly that reason: an
    // `s3 sync --delete` of the whole slides/ prefix against a partial dist would delete
    // every deck that wasn't rebuilt.
    /* Cleared PER DECK, not wholesale. `rmSync` on the whole of slides/ is right while a
     * site is one course and deletes every other course's decks the moment it isn't - the
     * same bug as wiping the whole of content/, in the one place I did not fix it. A site
     * with an announced course in it has no decks at all, so building that course removed
     * all 79 of the Data Analyst's; every slide step then requested a deck that was not
     * there, got the dev server's SPA fallback, and rendered THE APP inside the iframe.
     *
     * A course owns the deck directories of its own topics - `sources` - and nothing else.
     * Removing them first is what keeps the invariant the publish step relies on: what
     * lands here is what this run BUILT, not every deck the course has a source for. */
    const slidesOut = path.join(outDir, 'slides');
    for (const topic of sources.keys())
      fs.rmSync(path.join(slidesOut, topic), { recursive: true, force: true });
    if (built.size) {
      for (const topic of built)
        fs.cpSync(path.join(slidesDir, topic), path.join(slidesOut, topic), { recursive: true });
      log(`  slides: ${built.size} built deck${built.size === 1 ? '' : 's'} of ${sources.size} `
          + `[${[...built].sort(byNumber).join(', ')}]`);
    }
  }

  for (const w of warnings) log(`  ! ${w}`);

  /* The missing-asset lists are what `verify` fails on, and until now a plain `build` or a
   * `dev` said nothing about them at all - they are appended to `warnings` below, after
   * this log has already run. 294 ungradeable exercises went past in silence that way.
   *
   * Not printed in full, because a real one is hundreds of lines and would bury the build.
   * A count by kind and one example each is enough to say "go and run verify". */
  const problems = [
    ['figure', missingImages], ['embedded app', missingApps],
    ['section', missingSections], ['gradeable exercise', missingChecks],
    ['hand correction', missingCorrections],
  ].filter(([, list]) => list.length);
  if (problems.length) {
    const total = problems.reduce((n, [, list]) => n + list.length, 0);
    log(`  ${total} problem${total === 1 ? '' : 's'} verify will fail on:`);
    for (const [kind, list] of problems)
      log(`    ${String(list.length).padStart(4)} ${kind}${list.length === 1 ? '' : 's'}`
          + `  e.g. ${list[0].slice(0, 96)}`);
  }
  const { hits } = cache.stats();
  log(`  precomputed ${computed} expected result sets`
      + `${hits ? ` (${hits} exercise${hits === 1 ? '' : 's'} from cache)` : ''}`
      + `${failed ? `, ${failed} SOLUTIONS FAILED` : ''}`);

  warnings.push(...missingImages, ...missingApps, ...missingSections, ...missingChecks,
                ...missingCorrections);
  return { courses: [...courses.values()], datasets, manifest, computed, failed, warnings,
           missingImages, missingApps, missingSections, missingChecks, missingCorrections,
           decks, deckSources: sources };
}
