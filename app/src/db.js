/* An exercise's databases: the page's half.
 *
 * PGlite and every database an exercise uses live in `sql.worker.js`; this file decides when
 * one is made, says so while it is, and turns the exercise's questions into calls. See
 * worker-rpc.js for why a worker at all.
 */
import { ref } from 'vue';
import { spawn } from './worker-rpc.js';

const engine = spawn(() =>
  new Worker(new URL('./sql.worker.js', import.meta.url), { type: 'module' }));

/* Which exercise databases the worker has been asked to make, and which it has finished. Keyed
 * on everything that identifies one - see `key` in sql.worker.js for why the setup is part of
 * it. The page's key need not match the worker's, only be as specific. */
const sessions = new Map();
const ready = new Set();
const key = (course, dataset, setup = '') => JSON.stringify([course, dataset, setup || '']);

/* WHETHER A STUDENT'S DATABASE IS BEING MADE RIGHT NOW, for the overlay that covers the
 * editor while it is. Seeding a dataset and booting PGlite take seconds, and that now
 * happens as an exercise opens (see `warmDb`) rather than on a first Run. Same reason and
 * same shape as `pythonStarting` in py.js. */
export const dbStarting = ref(false);
let startingFor = 0;
const starting = async promise => {
  startingFor++;
  dbStarting.value = true;
  try { return await promise; } finally { if (--startingFor === 0) dbStarting.value = false; }
};

/** The student's long-lived database for this exercise's view of the dataset. */
function getDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  if (!sessions.has(k)) {
    const made = starting(engine.call('open', { course, dataset, setup })).then(() => { ready.add(k); });
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
  if (!ready.has(key(course, dataset, setup))) return null;
  return engine.call('lint', { course, dataset, setup, text }).catch(() => null);
}

/** Throw the student's database away and start again from the seeded state. */
export async function resetDb(course, dataset, setup) {
  const k = key(course, dataset, setup);
  sessions.delete(k);
  ready.delete(k);
  await engine.call('reset', { course, dataset, setup }).catch(() => {});
  return getDb(course, dataset, setup);
}

/** Run SQL against the student's database, and return the LAST statement's result. */
export async function run(course, dataset, sql, setup) {
  await getDb(course, dataset, setup);
  return engine.call('run', { course, dataset, setup, sql });
}

/** Run SQL against a throwaway copy, so grading never touches the student's own database. */
export const runScratch = (course, dataset, setup, sql) =>
  engine.call('scratch', { course, dataset, setup, sql });

/**
 * End whatever the database is doing, now - a cross join of two large tables included,
 * which nothing else can.
 *
 * Every database goes with the worker: the student's own, and the seeded datasets it was
 * cloned from. So the next Run starts again from the beginning, and seeds again first, which
 * is why the caller warms the exercise straight away. A query in flight rejects with
 * `message`, marked `stopped`.
 */
export function stopDb(message = 'Stopped.') {
  sessions.clear();
  ready.clear();
  engine.stop(message);
}
