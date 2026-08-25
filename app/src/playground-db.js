/* The Playground's SQL session: ONE database, added to.
 *
 * WHY THIS IS NOT `db.js`. That module caches a dumped data directory per dataset and
 * clones it with `loadDataDir`, which is exactly right for an exercise - each one wants
 * exactly one dataset and wants it instantly. It is useless for composition, because
 * loading a dump REPLACES the database. Two dumps cannot be merged. So a student loading
 * Film and then Sport has to be `exec`, and once it is `exec` the whole thing is three
 * lines. No new caching machinery, and `runOn` is already the editor's execute path.
 *
 * ATOMIC PER SET, FOR FREE. Postgres runs a multi-statement simple query as one implicit
 * transaction and its DDL is transactional, so a set that collides half way through rolls
 * back rather than leaving three of five tables behind. That also means collisions need no
 * declaration and no parsing: a second `CREATE TABLE films` raises `relation already
 * exists`, the whole set is undone, and the caller has something true to show. A
 * build-time check across co-loadable sets is still worth having - it tells an author
 * before it tells a student - but it is an improvement on this, not a prerequisite.
 *
 * IN MEMORY, NOT `idb://` - and that is a deviation from the plan, for a reason the plan
 * could not have known. PGlite refuses `loadDataDir` against a data directory that already
 * holds a database ("Database already exists, cannot load from tarball"), so with an idb
 * data directory the blank-dump reset below is not available at all: resetting would mean
 * deleting the IndexedDB store and paying a cold `initdb`, seconds, on a button a student
 * might press ten times. Persistence is worth having and should come back with the
 * multi-tab question answered - two tabs on one idb store have no locking between them.
 */
import { PGlite } from '@electric-sql/pglite';
import { EXTENSIONS } from '../../src/extensions.mjs';
import { loadDatasetSql } from './content.js';

let ready = null;

/* Booting PGlite costs seconds, so it happens once and lazily - a student who opens the
 * Playground and switches straight to Python should never pay for it. The blank dump is
 * taken immediately after, while the database is still empty, because that is the only
 * moment it is cheap and it is what Reset restores. */
function session() {
  if (!ready) ready = (async () => {
    const db = new PGlite({ extensions: EXTENSIONS });
    const blank = await db.dumpDataDir();
    return { db, blank };
  })();
  return ready;
}

/** The live database, booting it if this is the first time anyone asked. */
export const database = async () => (await session()).db;

/** Has the database been booted yet? Lets the UI say "starting" without causing it. */
export const started = () => ready !== null;

/**
 * Add one dataset to the live database. Rejects with Postgres's own message if it
 * collides with something already loaded, having changed nothing.
 */
export async function addDataset(course, name) {
  const { db } = await session();
  await db.exec(await loadDatasetSql(course, name));
}

/**
 * Empty the database.
 *
 * The blank dump rather than a fresh instance: a cold boot is seconds and restoring an
 * empty data directory is not. The old handle is closed rather than dropped, or its wasm
 * heap stays live for as long as the tab does.
 */
export async function reset() {
  const { db, blank } = await session();
  await db.close().catch(() => {});
  ready = Promise.resolve({ db: new PGlite({ loadDataDir: blank, extensions: EXTENSIONS }), blank });
  await ready;
}

/**
 * What is actually in the database right now: tables and views, with their columns.
 *
 * Derived from the database rather than tracked from what was loaded, so it also sees
 * whatever the student created in the editor themselves - which is the whole difference
 * between a schema view that helps and one that describes the manifest.
 *
 * NO ROW COUNTS. `pg_class.reltuples` is the planner's estimate and is -1 until something
 * analyses the table, so an honest count is `count(*)` per table - and this runs after
 * every query the student executes, because a query may have created something. One
 * catalogue read is free; six sequential scans of `sql_eda` after every SELECT is not.
 * Counts belong to the browse pane, which asks for one table at a time and only when
 * someone is looking at it.
 */
export async function schema() {
  const db = await database();
  const { rows } = await db.query(`
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
}
