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
      else if (s.title === 'Options') Object.assign(cur, { kind: 'mcq' }, optionsIn(s.body));
      else if (s.title === 'Feedback') cur.feedback = orderedIn(s.body);
    }
  }
  return { ...fm, file, prompt: intro, setup: sqlIn(setup?.body || ''), steps };
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

    // Expected values are computed at build time, so a volatile call means the step either
    // fails immediately or - worse - passes today and fails at midnight. The marker is
    // hand-written in the exercise, so a re-convert can wipe it; without this check that
    // would quietly restore strict grading and surface later as a data problem.
    const volatile = coding && !step.nondeterministic && volatileCall(step.solution);
    if (volatile)
      problems.push(`${where} uses ${volatile} but is not marked "### Nondeterministic" - `
        + 'its expected values cannot be reproduced');
  }
  return problems;
}

/**
 * Build a content directory. Returns the full model, which is also what gets written.
 */
export async function buildContent({ contentDir, outDir, write = true, log = console.log }) {
  const exDir = path.join(contentDir, 'exercises');
  if (!fs.existsSync(exDir)) throw new Error(`No exercises/ in ${contentDir}`);

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

  for (const topicId of fs.readdirSync(exDir).filter(d => /^\d/.test(d)).sort(byNumber)) {
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
  // A unit has a deck when the course repo has built one to slides/<unit>/index.html.
  // Derived rather than declared: a `slides:` key in _unit.json would be a second source
  // of truth that could disagree with what's actually on disk. `slides:` may still be set
  // to an absolute URL when a deck lives somewhere else entirely.
  const slidesDir = path.join(contentDir, 'slides');
  const decks = new Set(fs.existsSync(slidesDir)
    ? fs.readdirSync(slidesDir).filter(d => fs.existsSync(path.join(slidesDir, d, 'index.html')))
    : []);
  for (const course of courses.values())
    for (const u of topicsOf(course)) {
      if (u.slides) continue;                          // an explicit URL from _topic.json wins
      // index.html is named explicitly rather than relying on a directory index: S3 behind
      // CloudFront only applies defaultRootObject to the root, so `slides/1.2.3/` would
      // 404 in production, and a dev server answers it with the app's own index page -
      // which then loads the whole player inside the iframe.
      if (decks.has(u.topic)) u.slides = `slides/${u.topic}/index.html`;
      else if (fs.existsSync(path.join(slidesDir, u.topic)))
        warnings.push(`${u.topic}: slides/${u.topic}/ has no index.html - deck not published`);
    }

  // ---- load datasets ----
  // A dataset is either one <name>.sql, or a <name>/ directory of per-table .sql files
  // concatenated in filename order -- a dataset is a database, and a database may hold
  // more than one table. Either way it ships as a single <name>.sql, so the player only
  // ever fetches one file per dataset.
  const dataDir = path.join(contentDir, 'data');
  const datasets = {};
  for (const e of (fs.existsSync(dataDir) ? fs.readdirSync(dataDir, { withFileTypes: true }) : [])) {
    if (e.isDirectory()) {
      const dir = path.join(dataDir, e.name);
      const parts = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
      if (parts.length) datasets[e.name] = parts.join('\n');
    } else if (e.name.endsWith('.sql')) {
      datasets[e.name.replace(/\.sql$/, '')] = fs.readFileSync(path.join(dataDir, e.name), 'utf8');
    }
  }

  // ---- precompute expected results ----
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

  let computed = 0, failed = 0;
  for (const course of courses.values()) {
    for (const u of topicsOf(course)) {
      for (const ex of u.exercises) {
        if (ex.type !== 'coding' || !ex.dataset) continue;
        if (!datasets[ex.dataset]) { warnings.push(`${u.topic} ${ex.file}: dataset "${ex.dataset}" not extracted yet`); continue; }
        // An exercise's setup SQL builds the derived tables it needs on top of the
        // dataset. Applied once, to a copy, and dumped: every step then starts from a
        // database that already has them, and only exercises declaring setup pay for it.
        let dump = await template(ex.dataset);
        if (ex.setup) {
          try {
            dump = await withSetup(dump, ex.setup);
          } catch (e) {
            warnings.push(`${u.topic} ${ex.file}: setup failed - ${String(e.message).split('\n')[0]}`);
            failed++;
            continue;
          }
        }
        let shared = null;   // SELECT-only solutions share a database; DDL needs a clean one
        for (const step of ex.steps || []) {
          if (!step.solution) continue;
          const fresh = isDDL(step.solution);
          const db = fresh
            ? new PGlite({ loadDataDir: dump, extensions: EXTENSIONS })
            : (shared ||= new PGlite({ loadDataDir: dump, extensions: EXTENSIONS }));
          try {
            const res = await db.exec(step.solution);
            const last = res[res.length - 1];
            step.expected = {
              fields: (last?.fields || []).map(f => f.name),
              // Values are deliberately not carried for a non-deterministic step: they
              // would be compared against nothing and only mislead anyone reading the JSON.
              rows: step.nondeterministic ? [] : (last?.rows || []).slice(0, 1000),
              rowCount: last?.rows?.length ?? 0,
              ordered: /\border\s+by\b/i.test(step.solution),
              nondeterministic: !!step.nondeterministic,
              ddl: fresh,
            };
            computed++;
          } catch (e) {
            warnings.push(`${u.topic} ${ex.file}: solution failed - ${String(e.message).split('\n')[0]}`);
            failed++;
          } finally { if (fresh) await db.close(); }
        }
        await shared?.close();
      }
    }
  }

  // ---- emit ----
  const manifest = [];
  if (write) {
    const contentOut = path.join(outDir, 'content');
    fs.rmSync(contentOut, { recursive: true, force: true });
    fs.mkdirSync(contentOut, { recursive: true });

    for (const course of courses.values()) {
      const dir = path.join(contentOut, course.id);
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

      const used = new Set(topicsOf(course).flatMap(t => t.exercises.map(e => e.dataset)).filter(Boolean));
      const shipped = [];
      for (const d of used) {
        if (!datasets[d]) continue;
        fs.writeFileSync(path.join(dir, 'data', `${d}.sql`), datasets[d]);
        shipped.push(d);
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
          `datasets [${shipped.join(', ') || 'none'}]`);
    }
    fs.writeFileSync(path.join(contentOut, 'courses.json'), JSON.stringify(manifest, null, 2));

    // Decks sit at the site root, not under content/: a built Slidev deck is a small site
    // of its own with absolute asset paths, and its --base has to match where it lands.
    const slidesOut = path.join(outDir, 'slides');
    fs.rmSync(slidesOut, { recursive: true, force: true });
    if (decks.size) {
      for (const unit of decks)
        fs.cpSync(path.join(slidesDir, unit), path.join(slidesOut, unit), { recursive: true });
      log(`  slides: ${decks.size} deck${decks.size === 1 ? '' : 's'} [${[...decks].sort().join(', ')}]`);
    }
  }

  for (const w of warnings) log(`  ! ${w}`);
  log(`  precomputed ${computed} expected result sets${failed ? `, ${failed} SOLUTIONS FAILED` : ''}`);

  warnings.push(...missingImages, ...missingApps);
  return { courses: [...courses.values()], datasets, manifest, computed, failed, warnings,
           missingImages, missingApps };
}
