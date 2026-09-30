import { ref } from 'vue';
import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../../src/extensions.mjs';
import { loadDatasetSql } from './content.js';
import { lintSql } from './sqllint.js';

const templates = new Map();   // seeded data dir, so later databases are clones
const prepared = new Map();    // that dir with one exercise's setup SQL applied
const sessions = new Map();    // the student's own database
const ready = new Map();       // ...once it exists, so a check never waits for one

/* WHETHER A STUDENT'S DATABASE IS BEING MADE RIGHT NOW, for the overlay that covers the
 * editor while it is. Seeding a dataset and booting PGlite run on the main thread, and the
 * page can hold still while they do - which now happens as an exercise opens (see `warmDb`)
 * rather than on a first Run. Same reason and same shape as `pythonStarting` in py.js. */
export const dbStarting = ref(false);
let startingFor = 0;
const starting = async promise => {
  startingFor++;
  dbStarting.value = true;
  try { return await promise; } finally { if (--startingFor === 0) dbStarting.value = false; }
};

/* Setup SQL is per exercise, not per dataset, and two exercises on the same dataset can
 * build different tables under the same name - DataCamp's `matches_spain` is all of Spain
 * in one exercise and one season of it in another. So everything downstream of a dataset
 * is keyed by the setup as well, or the second exercise would inherit the first's tables. */
const key = (course, dataset, setup = '') =>
  `${course}/${dataset}${setup ? `#${fingerprint(setup)}` : ''}`;

function fingerprint(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Seed a dataset once, then keep its data directory so every later database is a
 * clone rather than a re-run of thousands of INSERTs.
 */
function template(course, dataset) {
  const k = key(course, dataset);
  if (!templates.has(k)) {
    templates.set(k, (async () => {
      const sql = await loadDatasetSql(course, dataset);
      const db = new PGlite({ extensions: EXTENSIONS });
      await db.exec(sql);
      const dump = await db.dumpDataDir();
      await db.close();
      return dump;
    })());
  }
  return templates.get(k);
}

/**
 * What an exercise starts from: the seeded dataset, plus its own setup SQL if it declares
 * any. Dumped once and reused, so the setup runs a single time however many databases the
 * exercise goes on to need.
 */
function startingPoint(course, dataset, setup) {
  if (!setup) return template(course, dataset);
  const k = key(course, dataset, setup);
  if (!prepared.has(k)) {
    prepared.set(k, (async () => {
      const db = new PGlite({ loadDataDir: await template(course, dataset), extensions: EXTENSIONS });
      try {
        await db.exec(setup);
        return await db.dumpDataDir();
      } finally { await db.close(); }
    })());
  }
  return prepared.get(k);
}

/** A throwaway database, so grading never touches the student's own. */
export async function scratch(course, dataset, setup) {
  return new PGlite({ loadDataDir: await startingPoint(course, dataset, setup), extensions: EXTENSIONS });
}

/** The student's long-lived database for this exercise's view of the dataset. */
export function getDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  if (!sessions.has(k)) {
    const made = starting(scratch(course, dataset, setup)).then(db => { ready.set(k, db); return db; });
    // A failure is not remembered: the next Run asks again rather than inheriting it.
    made.catch(() => { if (sessions.get(k) === made) sessions.delete(k); });
    sessions.set(k, made);
  }
  return sessions.get(k);
}

/* ---- the editor's checking --------------------------------------------------------
 *
 * MADE AS THE EXERCISE OPENS, like Python's interpreter: asked for before anybody presses
 * Run, so the check has something to ask - and the first Run then finds it already made.
 * Until it exists `checkSql` answers null and nothing is marked. */
export const warmDb = (course, dataset, setup) => getDb(course, dataset, setup).catch(() => null);

/** What Postgres would refuse in `text`, as `[{ from, to, message }]`, or null while there is
 *  no database to ask. Planned, never run - see sqllint.js. */
export function checkSql(course, dataset, setup, text) {
  const db = ready.get(key(course, dataset, setup));
  return db ? lintSql(db, text).catch(() => null) : null;
}

/** Throw the student's database away and start again from the seeded state. */
export async function resetDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  const existing = sessions.get(k);
  sessions.delete(k);
  ready.delete(k);
  await existing?.then(db => db.close()).catch(() => {});
  return getDb(course, dataset, setup);
}

/** Run SQL and return the LAST statement's result, which is what an editor shows. */
export async function runOn(db, sql) {
  const results = await db.exec(sql);
  const last = results[results.length - 1];
  return {
    fields: (last?.fields || []).map(f => f.name),
    rows: last?.rows || [],
    affected: last?.affectedRows ?? null,
  };
}

/** Run SQL against the student's database. */
export async function run(course, dataset, sql, setup) {
  return runOn(await getDb(course, dataset, setup), sql);
}
