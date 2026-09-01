/* Which exercises a student has solved, what they earned for them, and where they left off.
 *
 * Two backings, chosen by whether the deployment has auth: DynamoDB through /api/progress
 * when it does, localStorage when it doesn't. The local path is what makes `icecore dev`
 * and any unauthenticated static host work unchanged, and it is also the fallback if the
 * API is unreachable - losing progress should never block someone from practising.
 *
 * The place-marker follows the same rule, and for the same reason it is worth putting on
 * the server at all: a student who does one topic on a laptop and the next on a desktop
 * should still be resumed, not restarted.
 *
 * XP IS RECORDED WHEN IT IS EARNED, not summed from the content at read time. The amount
 * rides the solve and is written beside it - a row in DynamoDB, an entry in the local
 * record - so what a student has earned is a fact about them rather than a re-derivation of
 * whatever `xp:` happens to say today. Two things follow. Re-tuning an exercise's `xp:`
 * does not silently restate what everyone earned before the change; and the total can be
 * answered by a side of the wire that cannot see the catalogue, which is what makes a
 * per-course XP figure reachable from the admin panel later - the same reason its listing
 * queries per user.
 *
 * The client is the one that says how much a solve is worth, and that is not a hole worth
 * closing: it already says WHETHER the exercise was solved, the reference solution ships to
 * the browser, and every one of these assessments is formative. The Lambda caps the number
 * so a bug cannot write a nonsense total, not to keep anyone out.
 */
import { isEnabled, api } from './auth.js';
import * as store from './progress-store.js';

/**
 * How a row id is spelled everywhere progress is concerned - the solved set, and the
 * place-marker. See the note on load(): storage only ever hands ids back as strings.
 */
export const progressId = id => String(id);

const local = course => {
  const rec = store.earned(course);
  return {
    solved: new Set(Object.keys(rec)), last: store.place(course),
    xp: store.xpIn(rec), code: store.code(course),
  };
};

/**
 * Resolves to { solved: Set, last, xp, code }.
 *
 * `code` is what solved each exercise, keyed by exercise and then by step. It comes back
 * with the course rather than being asked for one exercise at a time: the rows are read in
 * full either way, so a second round trip would buy nothing but a spinner on the editor
 * every time a student opens something they have already done.
 *
 * EVERY ID THAT COMES BACK HERE IS A STRING - in `solved`, and in `last` - and callers must
 * compare as strings. `progressId()` below is the one spelling.
 *
 * An exercise id is a NUMBER in index.json, and every route it takes through storage turns
 * it into a string: a DynamoDB sort key is text, `localStorage.getItem` returns text, and so
 * is a JavaScript object key. Neither of the two failures this causes announces itself. A
 * Set of strings does not contain the number 1418943, so a course a student has worked
 * through reads as untouched. And a bookmark that never matches a row falls through to the
 * fallback, so "resume where you left off" silently becomes "start from the beginning" -
 * which looks like the feature working, on the one row where a string does meet a string:
 * a slides row, whose id this file did not make up.
 */
export async function load(course) {
  if (!isEnabled()) return local(course);
  try {
    const { solved, last, xp, code } = await api(`progress?course=${encodeURIComponent(course)}`);
    return {
      solved: new Set((solved || []).map(progressId)), last: last || null,
      xp: Number(xp) || 0, code: code || {},
    };
  } catch {
    return local(course);   // offline, or a bad day
  }
}

/**
 * XP earned today, across every course - the counter in the top bar.
 *
 * "Today" is the student's, so the browser computes the instant it starts at and the
 * server filters on that; nothing on the other side has to guess a timezone. Asked once a
 * session and then kept up to date in the app as exercises are solved, rather than re-asked
 * on every solve.
 */
export async function earnedToday() {
  if (!isEnabled()) return store.dayXp();
  try {
    const { xp } = await api(`progress?since=${encodeURIComponent(store.since())}`);
    return Number(xp) || 0;
  } catch {
    return store.dayXp();
  }
}

/**
 * Record one solved exercise: what it was worth, and the code that solved it.
 *
 * Always writes locally, so a failed call still shows through.
 *
 * `xp` IS OMITTED ON A RE-SOLVE and the amount already recorded stands. A student who comes
 * back to something they finished last month and improves their answer is updating their
 * code, not earning the exercise again - and re-sending the amount would quietly restate
 * what they earned in whatever `xp:` says today. Both sides honour that: nothing here sends
 * a number it does not mean, and the Lambda only writes the fields the call carries.
 */
export async function mark(course, exercise, { xp, solved = true, code } = {}) {
  const rec = store.earned(course);
  const first = solved && !(exercise in rec);
  if (solved) rec[exercise] = xp ?? rec[exercise] ?? 0; else delete rec[exercise];
  store.saveEarned(course, rec);
  if (first) store.addDayXp(xp);

  const codeRec = store.code(course);
  if (solved && code) codeRec[exercise] = code; else if (!solved) delete codeRec[exercise];
  store.saveCode(course, codeRec);

  if (!isEnabled()) return;
  try {
    const body = { course, exercise, solved };
    if (xp != null) body.xp = xp;
    if (code) body.code = code;
    await api('progress', { method: 'PUT', body });
  } catch {
    // Swallowed on purpose - the local copy holds, and the next load reconciles.
  }
}

/**
 * Remember where they are, on every move through the course.
 *
 * Not debounced. A timer would mean the last move of a session - the one the next visit
 * actually needs - is the one most likely to be lost when the tab closes, and recovering
 * that would take either a keepalive fetch that has to re-implement api()'s auth or a
 * timestamp on both copies to work out which is newer. One small fire-and-forget PUT per
 * navigation is cheaper than either, and it cannot be stale.
 */
export function remember(course, exercise) {
  if (!course || !exercise) return;
  store.setPlace(course, exercise);
  if (!isEnabled()) return;
  api('progress', { method: 'PUT', body: { course, last: exercise } }).catch(() => {});
}
