/* The Playground's SQL session: ONE database, added to.
 *
 * The database itself lives in `sql.worker.js`, in a worker instance of the Playground's
 * own; this file is the page's half. See worker-rpc.js for why a worker at all.
 *
 * WHY THIS IS NOT `db.js`. That one caches a dumped data directory per dataset and clones it
 * with `loadDataDir`, which is exactly right for an exercise - each one wants exactly one
 * dataset and wants it instantly. It is useless for composition, because loading a dump
 * REPLACES the database. Two dumps cannot be merged. So a student loading Film and then
 * Sport has to be `exec`, and once it is `exec` the whole thing is three lines. No new
 * caching machinery, and `runOn` is the same execute path the exercise editor uses.
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
 * data directory the blank-dump reset is not available at all: resetting would mean
 * deleting the IndexedDB store and paying a cold `initdb`, seconds, on a button a student
 * might press ten times. Persistence is worth having and should come back with the
 * multi-tab question answered - two tabs on one idb store have no locking between them.
 */
import { spawn } from './worker-rpc.js';

const engine = spawn(() =>
  new Worker(new URL('./sql.worker.js', import.meta.url), { type: 'module' }));

let booted = null;

/* Booting PGlite costs seconds, so it happens once and lazily - a student who opens the
 * Playground and switches straight to Python should never pay for it. */
export const boot = () =>
  booted ??= engine.call('pgBoot').catch(e => { booted = null; throw e; });

/** Has the database been asked for yet? Lets the UI say "starting" without causing it. */
export const started = () => booted !== null;

/**
 * Add one dataset to the live database. Rejects with Postgres's own message if it
 * collides with something already loaded, having changed nothing.
 */
export async function addDataset(course, name) {
  await boot();
  await engine.call('pgAdd', { course, name });
}

/** Empty the database, from a dump taken while it was still empty. */
export async function reset() {
  await boot();
  await engine.call('pgReset');
}

/** Run the student's SQL, and return the LAST statement's result. */
export async function run(sql) {
  await boot();
  return engine.call('pgRun', { sql });
}

/** One statement's `{ fields, rows }`, fields by name - what the data browser pages through. */
export async function query(sql) {
  await boot();
  return engine.call('pgQuery', { sql });
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
  await boot();
  return engine.call('pgSchema');
}

/**
 * End whatever the database is doing, and the database with it.
 *
 * The only way out of a query that will not finish. Every dataset the student loaded goes
 * with the worker, so the next call boots an empty database. A query in flight rejects with
 * `message`, marked `stopped`.
 */
export function stop(message = 'Stopped.') {
  booted = null;
  engine.stop(message);
}
