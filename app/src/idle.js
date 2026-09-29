/* RUN SOMETHING WHEN THE BROWSER HAS NOTHING BETTER TO DO, and within a few seconds even when
 * it never has. Used to warm what an exercise will need - Python, a student's database - so
 * that neither is waited for on a first Run, and so that the second or so either holds the
 * page for tends to land while the instructions are being read. One definition, because two
 * exercise types warm this way and two copies of the timeout would drift.
 *
 * Returns a function that cancels it, for an exercise left before it ran. */
const WAIT = 4000;

export function whenIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: WAIT });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1500);
  return () => clearTimeout(id);
}
