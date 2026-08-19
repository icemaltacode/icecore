/* Which exercises a student has solved.
 *
 * Two backings, chosen by whether the deployment has auth: DynamoDB through /api/progress
 * when it does, localStorage when it doesn't. The local path is what makes `icecore dev`
 * and any unauthenticated static host work unchanged, and it is also the fallback if the
 * API is unreachable - losing progress should never block someone from practising.
 */
import { isEnabled, api } from './auth.js';

const key = course => `ice-platform-progress:${course}`;

const local = {
  load: course => new Set(JSON.parse(localStorage.getItem(key(course)) || '[]')),
  save: (course, solved) => localStorage.setItem(key(course), JSON.stringify([...solved])),
};

export async function load(course) {
  if (!isEnabled()) return local.load(course);
  try {
    const { solved } = await api(`progress?course=${encodeURIComponent(course)}`);
    return new Set(solved);
  } catch {
    return local.load(course);   // offline, or the API is having a bad day
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
