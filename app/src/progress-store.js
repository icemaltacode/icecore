/* Where progress lives when there is no API behind it - and the one definition of its shape.
 *
 * Two callers write these exact localStorage keys: `progress.js`, which is the backing for
 * an open deployment and the fallback whenever a call fails, and `preview.js`, which stands
 * in for the whole API under `icecore dev --as <role>`. Same entries, so a disagreement
 * about the shape between them reads to a student as their progress having been lost.
 *
 * Pure and dependency-free, so both can import it: preview.js is imported by auth.js, which
 * progress.js imports in turn, and putting this in either of those would be a cycle.
 *
 * THE RECORD IS `{ exerciseId: xp }`, not a list of ids. XP is recorded when it is earned
 * rather than summed from the content later - see progress.js - so the local backing has to
 * hold the same fact the DynamoDB row does.
 */

const key = course => `ice-platform-progress:${course}`;
const placeKey = course => `ice-platform-place:${course}`;
/* The code that solved each exercise, kept apart from the XP record rather than folded
 * into it. Two facts with different shapes and different futures - XP is a number written
 * once, and a submission is text that may one day be worth keeping for an exercise nobody
 * has finished yet. Merging them would also mean migrating the record that already exists. */
const codeKey = course => `ice-platform-code:${course}`;
/* One counter for every course. "How much today" is a question about the student, not about
 * whichever course they happen to have open. */
const DAY_KEY = 'ice-platform-xp-day';

const read = k => {
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
};

/* WHICH ANSWERS HAVE BEEN LOOKED AT, and the warning preference that guards them.
 *
 * Revealing a solution forfeits the exercise's XP, so this has to outlive the page: a
 * student who reveals, reloads and then solves must still earn nothing, or the forfeit is a
 * suggestion. Kept per course, like the solved record, so resetting a course clears it too.
 *
 * LOCAL ONLY, DELIBERATELY. The forfeit reaches the server the moment it matters - the solve
 * itself sends `xp: 0` and the row keeps that forever. Recording the reveal remotely as well
 * would be a second write on a button press, and a second fact to keep in step with the
 * first. The cost is that revealing on one device and solving on another still earns: a
 * narrow enough case to accept out loud rather than build for.
 *
 * The warning is one preference for the whole platform rather than per course - "do not warn
 * me again" is a statement about the student, not about what they are studying. */
const revealKey = course => `ice-platform-revealed:${course}`;
const WARN_KEY = 'ice-platform-reveal-warn';

/** The exercise ids whose answer has been shown, as a Set of STRINGS - see progressId. */
export function revealed(course) {
  const raw = read(revealKey(course));
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}

export function reveal(course, exercise) {
  const set = revealed(course);
  set.add(String(exercise));
  localStorage.setItem(revealKey(course), JSON.stringify([...set]));
}

/** Whether to warn before showing an answer. Defaults to warning. */
export const warnOnReveal = () => localStorage.getItem(WARN_KEY) !== 'off';
export const stopRevealWarning = () => localStorage.setItem(WARN_KEY, 'off');

/* Forget one course entirely - the account screen's reset.
 *
 * IT LIVES HERE BECAUSE THE KEYS DO. A reset that cleared DynamoDB alone would leave a
 * browser holding the record it had just deleted, and progress.js falls back to the local
 * copy whenever a call fails - so the work would reappear the next time anything went
 * offline, which reads to a student as the reset not having worked.
 *
 * The day counter is deliberately left alone. It is across every course and is a fact about
 * the student's day rather than about this one, so clearing it would take away XP earned
 * this morning on something they did not reset. It starts again at midnight either way. */
export function forget(course) {
  localStorage.removeItem(key(course));
  localStorage.removeItem(placeKey(course));
  localStorage.removeItem(codeKey(course));
  // Starting a course again means the answers are unseen again - otherwise a reset course
  // is one a student can never earn anything on.
  localStorage.removeItem(revealKey(course));
}

/** What a course has earned so far, as `{ exerciseId: xp }`. */
export function earned(course) {
  const raw = read(key(course));
  /* Progress used to be a bare array of ids, written before any XP was recorded beside it.
   * Read as solved-for-nothing rather than migrated: no amount was ever stored to recover,
   * and the next solve rewrites the entry in the current shape. */
  if (Array.isArray(raw)) return Object.fromEntries(raw.map(id => [id, 0]));
  return raw && typeof raw === 'object' ? raw : {};
}

export const saveEarned = (course, rec) => localStorage.setItem(key(course), JSON.stringify(rec));

/** The total in a record. Every reader of one goes through this rather than adding up itself. */
export const xpIn = rec => Object.values(rec).reduce((n, x) => n + (Number(x) || 0), 0);

/** What solved each exercise, as `{ exerciseId: { stepIndex: source } }`. */
export function code(course) {
  const raw = read(codeKey(course));
  return raw && typeof raw === 'object' ? raw : {};
}
export const saveCode = (course, rec) => localStorage.setItem(codeKey(course), JSON.stringify(rec));

export const place = course => localStorage.getItem(placeKey(course)) || null;
export const setPlace = (course, exercise) => localStorage.setItem(placeKey(course), exercise);

/* The student's OWN day, never UTC's. A counter that rolls over at midnight in Greenwich
 * rolls over at 2am in Malta in summer and mid-evening in Auckland, and a student who
 * watches their day's total vanish while they are still working on it will not read that as
 * a timezone. Only the browser knows which day it is where they are sitting - which is also
 * why the API is asked for XP earned *since* an instant this side computes, rather than for
 * anything it calls "today". */
export const day = (d = new Date()) => [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, '0'),
  String(d.getDate()).padStart(2, '0'),
].join('-');

/** Local midnight, as the instant the API filters `at` against. */
export const since = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** XP earned today. A counter rather than a ledger: localStorage cannot be asked a question. */
export function dayXp() {
  const rec = read(DAY_KEY);
  return rec?.day === day() ? Number(rec.xp) || 0 : 0;
}

/* Only ever added to. Un-solving would have to know whether the exercise was solved today,
 * which the counter cannot say - and nothing in the player un-solves anything. The server
 * side has no such gap: it derives the day from the rows' own `at`. */
export function addDayXp(xp) {
  const total = dayXp() + (Number(xp) || 0);
  localStorage.setItem(DAY_KEY, JSON.stringify({ day: day(), xp: total }));
  return total;
}
