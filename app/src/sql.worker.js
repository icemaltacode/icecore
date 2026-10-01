/* PGlite, in a worker: an exercise's databases, or the Playground's one.
 *
 * `db.js` and `playground-db.js` are the page's halves. Each makes its OWN instance of this
 * worker and uses only its own half of the operations below, so stopping a runaway query in
 * one never touches the other. They share a file because they share `runOn`, and a second
 * copy of "what an editor shows" is how the two screens would come to disagree about it.
 *
 * See worker-rpc.js for why a worker at all.
 */
import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../../src/extensions.mjs';
import { loadDatasetSql } from './content.js';
import { lintSql } from './sqllint.js';
import { serve } from './worker-rpc.js';

/** Run SQL and return the LAST statement's result, which is what an editor shows. */
async function runOn(db, sql) {
  const results = await db.exec(sql);
  const last = results[results.length - 1];
  return {
    fields: (last?.fields || []).map(f => f.name),
    rows: last?.rows || [],
    affected: last?.affectedRows ?? null,
  };
}

/* ==== an exercise's databases ========================================================= */

const templates = new Map();   // seeded data dir, so later databases are clones
const prepared = new Map();    // that dir with one exercise's setup SQL applied
const sessions = new Map();    // the student's own database
const ready = new Map();       // ...once it exists, so a check never waits for one

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
async function scratch(course, dataset, setup) {
  return new PGlite({ loadDataDir: await startingPoint(course, dataset, setup), extensions: EXTENSIONS });
}

/** The student's long-lived database for this exercise's view of the dataset. */
function getDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  if (!sessions.has(k)) {
    const made = scratch(course, dataset, setup).then(db => { ready.set(k, db); return db; });
    // A failure is not remembered: the next Run asks again rather than inheriting it.
    made.catch(() => { if (sessions.get(k) === made) sessions.delete(k); });
    sessions.set(k, made);
  }
  return sessions.get(k);
}

/* ==== the Playground's one database ===================================================
 *
 * ONE DATABASE, ADDED TO - see playground-db.js for why it is `exec` rather than the
 * exercise side's cloned dumps, and why it is in memory rather than `idb://`. */
let playground = null;

/* The blank dump is taken immediately after booting, while the database is still empty,
 * because that is the only moment it is cheap and it is what Reset restores. */
function pg() {
  if (!playground) playground = (async () => {
    const db = new PGlite({ extensions: EXTENSIONS });
    const blank = await db.dumpDataDir();
    return { db, blank };
  })();
  return playground;
}

serve({
  /* -- an exercise ------------------------------------------------------------------ */

  /** Make the student's database for this exercise, if it does not exist yet. */
  async open({ course, dataset, setup }) { await getDb(course, dataset, setup); return true; },

  /** Run SQL against the student's database. */
  async run({ course, dataset, setup, sql }) { return runOn(await getDb(course, dataset, setup), sql); },

  /** Run SQL against a throwaway copy, so a failed attempt cannot break their session. */
  async scratch({ course, dataset, setup, sql }) {
    const db = await scratch(course, dataset, setup);
    try { return await runOn(db, sql); } finally { await db.close().catch(() => {}); }
  },

  /** Throw the student's database away. The page makes the next one. */
  async reset({ course, dataset, setup }) {
    const k = key(course, dataset, setup);
    const existing = sessions.get(k);
    sessions.delete(k);
    ready.delete(k);
    await existing?.then(db => db.close()).catch(() => {});
    return true;
  },

  /* What Postgres would refuse in `text`, or null while there is no database to ask -
   * NEVER waiting for one to be made. Planned, never run: see sqllint.js. */
  lint({ course, dataset, setup, text }) {
    const db = ready.get(key(course, dataset, setup));
    return db ? lintSql(db, text) : null;
  },

  /* -- the Playground --------------------------------------------------------------- */

  async pgBoot() { await pg(); return true; },

  /* Rejects with Postgres's own message if the set collides with something already loaded,
   * having changed nothing: a multi-statement query is one implicit transaction. */
  async pgAdd({ course, name }) {
    const { db } = await pg();
    await db.exec(await loadDatasetSql(course, name));
    return true;
  },

  /* The blank dump rather than a fresh instance: a cold boot is seconds and restoring an
   * empty data directory is not. The old handle is closed rather than dropped, or its wasm
   * heap stays live for as long as the worker does. */
  async pgReset() {
    const { db, blank } = await pg();
    await db.close().catch(() => {});
    playground = Promise.resolve({ db: new PGlite({ loadDataDir: blank, extensions: EXTENSIONS }), blank });
    await playground;
    return true;
  },

  async pgRun({ sql }) { return runOn((await pg()).db, sql); },

  /** One statement's rows, with its field names - what the data browser pages through. */
  async pgQuery({ sql }) {
    const { fields, rows } = await (await pg()).db.query(sql);
    return { fields: fields.map(f => f.name), rows };
  },

  /* What is actually in the database right now: tables and views, with their columns.
   * See `schema` in playground-db.js for why there are no row counts. */
  async pgSchema() {
    const { rows } = await (await pg()).db.query(`
      SELECT c.relname AS table_name,
             c.relkind AS kind,
             a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS data_type
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'v', 'm')
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY c.relname, a.attnum`);

    const tables = new Map();
    for (const r of rows) {
      if (!tables.has(r.table_name))
        tables.set(r.table_name, { name: r.table_name, view: r.kind !== 'r', columns: [] });
      tables.get(r.table_name).columns.push({ name: r.column_name, type: r.data_type });
    }
    return [...tables.values()];
  },
});
