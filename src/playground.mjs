/* The Playground's manifest: the only thing its content repo authors.
 *
 * The platform owns the editor, the runtimes, the picker and the browser. A playground
 * repo owns a list of what to offer - and the datasets it offers are BORROWED from the
 * course that authored them, named by `{course, name}` rather than copied. That is what
 * keeps twenty megabytes of teaching data in one place and keeps this repo free of course
 * content, which is the rule the whole platform is built around.
 *
 * ONE PARSE, TWO CONSUMERS - the same argument as `decks.mjs`. `build` emits the manifest
 * and `verify` fails on it, and if each read the file itself the two would disagree about
 * what a valid manifest is exactly when it mattered.
 *
 * WHAT THIS CAN AND CANNOT CHECK. It sees the manifest and the starter files beside it, and
 * nothing else: the datasets live in another repo, built by another pipeline. So it checks
 * structure - ids, shapes, duplicates, starters that exist - and says nothing about whether
 * `icex-data-analyst/films` is still called that. Resolving a pair needs either sibling
 * checkouts or the published bucket, and those are separate checks in separate places.
 * Pretending otherwise here would be a check that passes because it looked at nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST = 'playground.json';
const STARTERS = ['playground', 'starters'];

const LANGUAGES = ['sql', 'python'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
/* A module number, which is what a Python data directory is keyed by. It used to be a unit
 * (`2.4`, matched by /^\d+\.\d+$/) - a DataCamp course's loose files are shared across all
 * its chapters, and a DataCamp course is a module now. The `module-` prefix on the published
 * directory belongs to the platform, so a manifest says `"4"` and never spells the path. */
const MODULE = /^\d+$/;

/**
 * Read and validate `<contentDir>/playground.json`.
 *
 * Returns null when there is none - most courses are not playgrounds, and that is not a
 * problem to report. Otherwise `{ manifest, problems }`: the manifest in the shape the
 * player consumes, and everything wrong with it. `verify` fails on the problems; `build`
 * emits the manifest anyway, because a half-valid playground is still worth running
 * locally and the failure is already loud.
 */
export function readPlayground(contentDir) {
  const file = path.join(contentDir, MANIFEST);
  if (!fs.existsSync(file)) return null;

  const problems = [];
  const bad = m => problems.push(`${MANIFEST}: ${m}`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { manifest: null, problems: [`${MANIFEST}: ${e.message}`] }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { manifest: null, problems: [`${MANIFEST}: expected an object with sql and/or python in it`] };

  for (const key of Object.keys(raw))
    if (!LANGUAGES.includes(key) && !key.startsWith('_'))
      bad(`"${key}" is not a language - expected ${LANGUAGES.join(' or ')}`);

  const manifest = {};
  for (const lang of LANGUAGES) {
    if (raw[lang] === undefined) continue;
    const section = readLanguage(lang, raw[lang], contentDir, bad);
    if (section) manifest[lang] = section;
  }
  if (!Object.keys(manifest).length && !problems.length)
    bad('declares no languages - a playground with nothing in it would open empty');

  return { manifest, problems };
}

function readLanguage(lang, section, contentDir, bad) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    bad(`${lang} must be an object`);
    return null;
  }
  if (!Array.isArray(section.sets) || !section.sets.length) {
    bad(`${lang}.sets must be a non-empty array`);
    return null;
  }

  /* Python's may-be-loaded list. NOT the set loaded up front: nothing is fetched until an
   * import asks for it, so this is the ceiling rather than the cost of opening the tab. */
  let packages;
  if (lang === 'python' && section.packages !== undefined) {
    if (!Array.isArray(section.packages) || section.packages.some(p => typeof p !== 'string'))
      bad('python.packages must be an array of package names');
    else packages = section.packages;
  }

  const ids = new Set();
  /* Sets load ADDITIVELY into one database and one working directory, so a name offered by
   * two sets is a collision the moment a student loads both. Tracked across the language
   * rather than within a set for exactly that reason - within a set it would be an obvious
   * mistake, across sets it is the one that only shows up in front of a student. */
  const claimed = new Map();
  const sets = [];

  for (const [i, s] of section.sets.entries()) {
    const at = `${lang}.sets[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { bad(`${at} must be an object`); continue; }
    if (typeof s.id !== 'string' || !ID.test(s.id)) {
      bad(`${at} needs an id of lowercase letters, digits and hyphens`);
      continue;
    }
    const label = `${lang} set "${s.id}"`;
    if (ids.has(s.id)) { bad(`${label} is declared twice`); continue; }
    ids.add(s.id);
    if (typeof s.title !== 'string' || !s.title.trim())
      bad(`${label} needs a title - it is what the picker shows`);

    const set = { id: s.id, title: String(s.title || s.id), blurb: s.blurb || undefined };

    if (lang === 'sql') set.datasets = readDatasets(s, label, claimed, bad);
    else set.files = readFiles(s, label, claimed, bad);

    /* STARTERS ARE AUTHORED AS FILES AND SHIP AS TEXT.
     *
     * A twelve-line query written as a JSON string full of escapes is a starter nobody
     * edits again, so the source is a real .sql or .py with highlighting and a diff that
     * reads. The player gets it inlined here instead of fetching one file per set: the
     * whole manifest is a few kilobytes, and a round trip on every click of the picker
     * buys nothing. Authored file and published file differ, exactly as an exercise's
     * markdown and its index.json entry do. */
    if (s.starter !== undefined) {
      if (typeof s.starter !== 'string' || !s.starter.trim()) bad(`${label}: starter must be a filename`);
      else {
        const from = path.join(contentDir, ...STARTERS, s.starter);
        if (!fs.existsSync(from)) bad(`${label}: no starter at ${STARTERS.join('/')}/${s.starter}`);
        else set.starter = fs.readFileSync(from, 'utf8').replace(/\s+$/, '');
      }
    }

    sets.push(set);
  }

  return { ...(packages ? { packages } : {}), sets };
}

/* A SQL set names datasets in their owning course. `{course, name}` is the shape
 * `loadDatasetSql(courseId, dataset)` already takes, so nothing translates between the
 * manifest and the fetch. */
function readDatasets(s, label, claimed, bad) {
  if (!Array.isArray(s.datasets) || !s.datasets.length) {
    bad(`${label} needs a non-empty datasets array`);
    return [];
  }
  const out = [];
  for (const d of s.datasets) {
    if (!d || typeof d.course !== 'string' || typeof d.name !== 'string') {
      bad(`${label}: every dataset needs a course and a name`);
      continue;
    }
    const ref = `${d.course}/${d.name}`;
    const owner = claimed.get(ref);
    /* Two sets loading the same dataset is not a saving, it is a guaranteed collision:
     * every table in it would be created twice. Caught here because it is structural -
     * TABLE-name collisions between DIFFERENT datasets need the SQL itself and are checked
     * where the SQL can be seen. */
    if (owner) bad(`${label}: ${ref} is already in set "${owner}" - loading both would collide`);
    else claimed.set(ref, s.id);
    out.push({ course: d.course, name: d.name });
  }
  return out;
}

/* A Python set names files inside a course's per-module data directory, plus the name the
 * student's own code will open them by. */
function readFiles(s, label, claimed, bad) {
  if (!Array.isArray(s.files) || !s.files.length) {
    bad(`${label} needs a non-empty files array`);
    return [];
  }
  const out = [];
  for (const f of s.files) {
    /* Named explicitly so a manifest written against the old numbering fails with the
     * reason rather than with "every file needs a course, a module and a name". Python data
     * moved from a per-unit directory to a per-module one when a DataCamp course stopped
     * being a unit, and a manifest is authored in another repo on another schedule - so the
     * one that has not caught up yet is the normal case, not the exceptional one. */
    if (f && typeof f.unit === 'string' && f.module === undefined) {
      bad(`${label}: "unit": "${f.unit}" is the old numbering - Python data is per module `
        + `now, so this is "module": "${String(f.unit).split('.')[0]}"`);
      continue;
    }
    if (!f || typeof f.course !== 'string' || typeof f.name !== 'string' || typeof f.module !== 'string') {
      bad(`${label}: every file needs a course, a module and a name`);
      continue;
    }
    if (!MODULE.test(f.module)) {
      bad(`${label}: "${f.module}" is not a module number - Python data lives under `
        + 'data/module-<n>/');
      continue;
    }
    /* `as` is the WORKING filename, and it is the whole reason this field exists: a student
     * writes `pd.read_csv('gapminder.csv')`, never a path into someone else's module
     * directory. It is also the only knob that resolves a collision without renaming
     * anything in the course the file belongs to. */
    const as = typeof f.as === 'string' && f.as.trim() ? f.as.trim() : f.name;
    if (as.includes('/'))
      bad(`${label}: "${as}" must be a bare filename - files mount at the working directory`);
    const owner = claimed.get(as);
    // Files mount into ONE working directory, so the second write silently wins. Silently
    // is the problem: the student reads whichever set they happened to load last.
    if (owner === s.id) bad(`${label}: "${as}" is mounted twice by this set`);
    else if (owner) bad(`${label}: "${as}" is also mounted by set "${owner}"`);
    else claimed.set(as, s.id);
    out.push({ course: f.course, module: f.module, name: f.name, ...(as === f.name ? {} : { as }) });
  }
  return out;
}

/**
 * Every distinct thing a manifest borrows, as a course id and the path it would be
 * published at. What the cross-repo and publish-time checks resolve, and what the size
 * stamp walks.
 */
/* WHERE A BORROWED THING IS PUBLISHED, relative to its owning course's content prefix.
 *
 * One definition, because three things have to agree about it and they run in three
 * different places: `borrowed()` below, the sibling-checkout check, and the pipeline
 * resolving against the live bucket. A dataset always publishes as a single `<name>.sql`
 * even when it was authored as a directory of files - the builder concatenates - so this is
 * the published shape, not the authored one. */
export const publishedPath = ref =>
  ref.module ? `data/module-${ref.module}/${ref.name}` : `data/${ref.name}.sql`;

export function borrowed(manifest) {
  const sql = (manifest?.sql?.sets || []).flatMap(s => s.datasets || [])
    .map(d => ({ kind: 'dataset', course: d.course, name: d.name, path: publishedPath(d) }));
  const py = (manifest?.python?.sets || []).flatMap(s => s.files || [])
    .map(f => ({ kind: 'file', course: f.course, name: f.name, path: publishedPath(f) }));
  const seen = new Set();
  return [...sql, ...py].filter(r => {
    const k = `${r.course} ${r.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------------------------
 * Resolving what a manifest borrows, against sibling checkouts of the courses it borrows
 * FROM.
 *
 * This is the only check that can see a collision before a student does, because a
 * collision needs the dataset SQL and the playground repo does not have it:
 *
 *     icecore verify content ../icecore-datacamp-data-analyst/content
 *
 * It is not the load-bearing one. A local checkout may be ahead of or behind what is
 * actually published, so the check that decides whether the Playground works is the
 * publish pipeline's, against the bucket. This one tells an author sooner.
 *
 * IT SAYS WHEN IT DID NOT RUN. A course nobody passed is reported as unchecked rather than
 * passed - "publishing less than you meant to" is silent by nature, and a check that
 * quietly looked at nothing is its cousin.
 * ---------------------------------------------------------------------------------- */

/** Read a content directory's course id, or null if it is not one. */
function courseIdOf(dir) {
  const f = path.join(dir, 'course.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).id || null; } catch { return null; }
}

/* A dataset is either `<name>.sql` or a `<name>/` directory of .sql concatenated in
 * filename order - the same two shapes the builder accepts, because this has to agree with
 * what actually gets published. */
function datasetSql(dir, name) {
  const one = path.join(dir, 'data', `${name}.sql`);
  if (fs.existsSync(one)) return fs.readFileSync(one, 'utf8');
  const many = path.join(dir, 'data', name);
  if (fs.existsSync(many) && fs.statSync(many).isDirectory()) {
    const files = fs.readdirSync(many).filter(f => f.endsWith('.sql')).sort();
    if (files.length) return files.map(f => fs.readFileSync(path.join(many, f), 'utf8')).join('\n');
  }
  return null;
}

/* What a dataset would create. A regex over the SQL rather than a parse: this is a warning
 * that arrives early, and the authoritative answer is Postgres refusing the second CREATE
 * at load time - which it does atomically, so a name missed here costs an honest error
 * message rather than a broken database. */
const CREATES = /^[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z_0-9$]*)"?/gim;
function relationsIn(sql) {
  const names = new Set();
  for (const m of sql.matchAll(CREATES)) names.add(m[1].toLowerCase());
  return names;
}

/**
 * Check a manifest against sibling content directories.
 *
 * Returns `{ problems, notes }` - problems fail `verify`, notes say what was skipped.
 */
export function checkAgainst(manifest, contentDirs) {
  const problems = [];
  const notes = [];
  if (!manifest) return { problems, notes };

  const byCourse = new Map();
  for (const dir of contentDirs) {
    const id = courseIdOf(dir);
    if (id && !byCourse.has(id)) byCourse.set(id, dir);
  }

  const refs = borrowed(manifest);
  for (const c of [...new Set(refs.map(r => r.course))].filter(c => !byCourse.has(c)))
    notes.push(`${c} was not passed, so nothing it lends was resolved`
      + ' - pass its content directory to check it');

  for (const ref of refs) {
    const dir = byCourse.get(ref.course);
    if (!dir) continue;
    // A SQL dataset has two published shapes and one of them is a directory, so existence
    // is asked of the loader rather than of the path.
    const there = ref.kind === 'dataset'
      ? datasetSql(dir, ref.name) !== null
      : fs.existsSync(path.join(dir, ref.path));
    if (!there) problems.push(`${MANIFEST}: ${ref.course} does not publish ${ref.path}`);
  }

  /* Relation collisions across every pair of sets that CAN be co-loaded - which is all of
   * them, because loading is additive by design. Reported per pair of sets rather than per
   * table, because the author's question is "which two of these can a student not have at
   * once". */
  const owners = new Map();     // relation name -> the set ids that would create it
  for (const set of manifest.sql?.sets || [])
    for (const d of set.datasets || []) {
      const dir = byCourse.get(d.course);
      const sql = dir && datasetSql(dir, d.name);
      if (!sql) continue;
      for (const rel of relationsIn(sql)) {
        if (!owners.has(rel)) owners.set(rel, new Set());
        owners.get(rel).add(set.id);
      }
    }
  const clashes = new Map();    // "a|b" -> the relations they both define
  for (const [rel, holders] of owners) {
    const sets = [...holders].sort();
    for (let i = 0; i < sets.length; i++)
      for (let j = i + 1; j < sets.length; j++) {
        const k = `${sets[i]}|${sets[j]}`;
        if (!clashes.has(k)) clashes.set(k, []);
        clashes.get(k).push(rel);
      }
  }
  for (const [pair, rels] of clashes) {
    const [a, b] = pair.split('|');
    problems.push(`${MANIFEST}: sql sets "${a}" and "${b}" both define `
      + `${rels.sort().join(', ')} - a student loading both would be refused the second`);
  }

  return { problems, notes };
}

/* ------------------------------------------------------------------------------------
 * Resolving against what is ACTUALLY PUBLISHED, and stamping the sizes in.
 *
 * THIS IS THE LOAD-BEARING CHECK. The structural one sees only the manifest; the
 * sibling-checkout one sees a working copy that may be ahead of or behind the bucket. This
 * one asks the bucket, which is the thing a student's browser will ask. A renamed dataset
 * is invisible to the repo that borrows it - the manifest still parses, the build still
 * succeeds, and the failure arrives as a set that will not load, in front of a student.
 *
 * IT ALSO STAMPS THE SIZE, and that is not a bolt-on. The picker has to say a set is 13MB
 * BEFORE it is loaded, and the player cannot know without fetching - which is exactly what
 * the label exists to prevent. The bucket is the only place the honest number exists, so
 * the check that visits it is the one that should carry it back. The authored manifest and
 * the published one therefore differ, the same way an exercise's markdown and its
 * index.json entry do.
 * ---------------------------------------------------------------------------------- */

/**
 * Parse `aws s3 ls --recursive` output into a map of `<course>/<path>` -> bytes.
 *
 * The raw listing rather than something jq-shaped, on purpose: the pipeline should not have
 * to reformat before it can ask a question, and a reformatting step is one more place for a
 * key to end up built differently from the way `publishedPath` builds it.
 */
export function readListing(text, prefix = 'content/') {
  const sizes = new Map();
  for (const line of String(text).split('\n')) {
    // date time size key. Split off exactly three leading fields - a key may contain spaces.
    const m = /^\s*\S+\s+\S+\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[2];
    if (!key.startsWith(prefix)) continue;
    sizes.set(key.slice(prefix.length), Number(m[1]));
  }
  return sizes;
}

/**
 * Check every borrowed reference against a listing, and return a copy of the manifest with
 * `bytes` stamped on each entry.
 *
 * `{ problems, manifest, total }` - a problem is a reference the bucket does not have, and
 * `total` is bytes per language, for the log.
 */
export function resolveAgainst(manifest, sizes) {
  const problems = [];
  const out = JSON.parse(JSON.stringify(manifest || {}));
  const total = {};
  for (const lang of LANGUAGES) {
    if (!out[lang]) continue;
    let bytes = 0;
    for (const set of out[lang].sets || []) {
      for (const ref of [...(set.datasets || []), ...(set.files || [])]) {
        const path = publishedPath(ref);
        const n = sizes.get(`${ref.course}/${path}`);
        if (n === undefined) {
          problems.push(`${MANIFEST}: ${lang} set "${set.id}" borrows ${ref.course}/${path}, `
            + 'which is not published on this site');
          continue;
        }
        ref.bytes = n;
        bytes += n;
      }
    }
    total[lang] = bytes;
  }
  return { problems, manifest: out, total };
}
