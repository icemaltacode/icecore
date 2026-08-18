import { PGlite } from '@electric-sql/pglite';
import { loadDatasetSql } from './content.js';

const key = (course, dataset) => `${course}/${dataset}`;
const templates = new Map();   // seeded data dir, so later databases are clones
const sessions = new Map();    // the student's own database, per dataset

/**
 * Seed a dataset once, then keep its data directory so every later database is a
 * clone rather than a re-run of thousands of INSERTs.
 */
function template(course, dataset) {
  const k = key(course, dataset);
  if (!templates.has(k)) {
    templates.set(k, (async () => {
      const sql = await loadDatasetSql(course, dataset);
      const db = new PGlite();
      await db.exec(sql);
      const dump = await db.dumpDataDir();
      await db.close();
      return dump;
    })());
  }
  return templates.get(k);
}

/** A throwaway database, so grading never touches the student's own. */
export async function scratch(course, dataset) {
  return new PGlite({ loadDataDir: await template(course, dataset) });
}

/** The student's long-lived database for this dataset. */
export function getDb(course, dataset) {
  const k = key(course, dataset);
  if (!sessions.has(k)) sessions.set(k, scratch(course, dataset));
  return sessions.get(k);
}

/** Throw the student's database away and start again from the seeded state. */
export async function resetDb(course, dataset) {
  const k = key(course, dataset);
  const existing = sessions.get(k);
  sessions.delete(k);
  await existing?.then(db => db.close()).catch(() => {});
  return getDb(course, dataset);
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
export async function run(course, dataset, sql) {
  return runOn(await getDb(course, dataset), sql);
}
