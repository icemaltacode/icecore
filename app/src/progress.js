/* Which exercises a student has solved, and where they left off.
 *
 * Two backings, chosen by whether the deployment has auth: DynamoDB through /api/progress
 * when it does, localStorage when it doesn't. The local path is what makes `icecore dev`
 * and any unauthenticated static host work unchanged, and it is also the fallback if the
 * API is unreachable - losing progress should never block someone from practising.
 *
 * The place-marker follows the same rule, and for the same reason it is worth putting on
 * the server at all: a student who does one topic on a laptop and the next on a desktop
 * should still be resumed, not restarted.
 */
import { isEnabled, api } from './auth.js';

const key = course => `ice-platform-progress:${course}`;
const placeKey = course => `ice-platform-place:${course}`;

const local = {
  load: course => new Set(JSON.parse(localStorage.getItem(key(course)) || '[]')),
  save: (course, solved) => localStorage.setItem(key(course), JSON.stringify([...solved])),
  place: course => localStorage.getItem(placeKey(course)) || null,
  setPlace: (course, exercise) => localStorage.setItem(placeKey(course), exercise),
};

/** Resolves to { solved: Set, last: exerciseId | null }. */
export async function load(course) {
  if (!isEnabled()) return { solved: local.load(course), last: local.place(course) };
  try {
    const { solved, last } = await api(`progress?course=${encodeURIComponent(course)}`);
    return { solved: new Set(solved), last: last || null };
  } catch {
    return { solved: local.load(course), last: local.place(course) };   // offline, or a bad day
  }
}

/** Record one solved exercise. Always writes locally, so a failed call still shows through. */
export async function mark(course, exercise, solved = true) {
  const current = local.load(course);
  solved ? current.add(exercise) : current.delete(exercise);
  local.save(course, current);
  if (!isEnabled()) return;
  try {
    await api('progress', { method: 'PUT', body: { course, exercise, solved } });
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
  local.setPlace(course, exercise);
  if (!isEnabled()) return;
  api('progress', { method: 'PUT', body: { course, last: exercise } }).catch(() => {});
}
