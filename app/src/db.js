import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../../src/extensions.mjs';
import { loadDatasetSql } from './content.js';

const templates = new Map();   // seeded data dir, so later databases are clones
const prepared = new Map();    // that dir with one exercise's setup SQL applied
const sessions = new Map();    // the student's own database

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
  if (!sessions.has(k)) sessions.set(k, scratch(course, dataset, setup));
  return sessions.get(k);
}

/** Throw the student's database away and start again from the seeded state. */
export async function resetDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  const existing = sessions.get(k);
  sessions.delete(k);
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
