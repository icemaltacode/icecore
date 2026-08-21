/* The little square beside a row, in the sidebar and in the Contents modal.
 *
 * Shared rather than written twice: the two lists sit side by side on screen, and a badge
 * that disagrees between them reads as a different exercise rather than the same one.
 *
 * WHY SOME ARE DRAWN AND SOME ARE TYPED. A badge has to say what a row IS at 13 pixels, and
 * the Unicode that gets reached for first says something else: `?` on a multiple-choice row
 * reads as "unknown" or "help", and `>` on a slide row reads as Play, so a deck looked like
 * a video. Neither is a rendering problem to be fixed with a nicer glyph - they are the
 * wrong pictures. Those two are drawn instead, as paths in a 16x16 box.
 *
 * `SQL` and the tick stay as text because they are already exactly what they mean, and a
 * drawn tick would be a worse tick.
 *
 * Drawn in `currentColor` with no fill of their own, so they inherit whatever the row's
 * state has set - the done and section variants recolour the badge and the icon follows.
 */

/* Choose one of these. A filled radio above an empty one, each against its option: the
 * affordance the exercise actually presents, rather than a question mark. */
const MCQ = { viewBox: '0 0 16 16', body: `
  <circle cx="4" cy="4.75" r="2.15" fill="currentColor" stroke="none"/>
  <circle cx="4" cy="11.25" r="2.15"/>
  <path d="M8.75 4.75h5.25M8.75 11.25h5.25"/>` };

/* A screen on a stand. Deliberately NOT a play triangle and NOT a film frame: the row is a
 * run of slides to read through, and every video-ish glyph promises something that plays. */
const SLIDES = { viewBox: '0 0 16 16', body: `
  <rect x="1.75" y="2.25" width="12.5" height="8.5" rx="1.5"/>
  <path d="M8 10.75V13.5M5.5 13.5h5"/>` };

/* Python's own logo, because "PY" is a label and a student recognises the snakes.
 *
 * Carbon's `logo-python`, Apache-2.0, embedded rather than depended on: adding an icon
 * package to the player to draw one 13px badge is a dependency for a shape that will
 * never change.
 *
 * It is a FILLED path on a 32-unit grid, unlike the two above, which is why an icon now
 * carries its own viewBox and says whether it is drawn or filled - a stroke width meant
 * for a 16-unit grid comes out at a quarter of the weight on this one.
 *
 * SQL stays as text. There is no SQL logo, only vendors' logos, and a PostgreSQL
 * elephant would claim something about the exercise that the exercise does not say.
 */
const PYTHON = { viewBox: '0 0 32 32', filled: true, body: `<path fill="currentColor" d="M23.488 9.14v2.966a4.284 4.284 0 0 1-4.173 4.236h-6.672a3.41 3.41 0 0 0-3.34 3.394v6.36c0 1.81 1.574 2.876 3.34 3.395a11.2 11.2 0 0 0 6.672 0c1.682-.487 3.34-1.467 3.34-3.394V23.55h-6.672v-.849h10.012c1.941 0 2.665-1.354 3.34-3.386a11.46 11.46 0 0 0 0-6.79c-.48-1.932-1.396-3.386-3.34-3.386Zm-3.752 16.108a1.273 1.273 0 1 1-1.254 1.269a1.26 1.26 0 0 1 1.254-1.27"/><path fill="none" d="M19.736 25.248a1.273 1.273 0 1 1-1.254 1.269a1.26 1.26 0 0 1 1.254-1.27"/><path fill="currentColor" d="M15.835 2a19 19 0 0 0-3.192.273c-2.827.499-3.34 1.544-3.34 3.472V8.29h6.68v.849H6.796a4.17 4.17 0 0 0-4.173 3.387a12.5 12.5 0 0 0 0 6.789c.475 1.977 1.609 3.386 3.55 3.386H8.47V19.65a4.245 4.245 0 0 1 4.173-4.15h6.672a3.365 3.365 0 0 0 3.34-3.394V5.745a3.73 3.73 0 0 0-3.34-3.472A21 21 0 0 0 15.835 2m-3.612 2.048a1.273 1.273 0 1 1-1.254 1.277a1.27 1.27 0 0 1 1.254-1.277"/><path fill="none" d="M12.223 4.048a1.273 1.273 0 1 1-1.254 1.277a1.27 1.27 0 0 1 1.254-1.277"/>` };

const ICONS = { mcq: MCQ, slides: SLIDES, python: PYTHON };

/* The language a coding exercise is written in, because that is the thing a student is
 * deciding when they look at the row - SQL and Python are different work.
 *
 * Every type is named. `coding` used to be the DEFAULT rather than an entry, so `python`
 * fell through it and 313 Python exercises wore an SQL badge in both lists. A default that
 * names a specific language is a default that lies about every type added after it. */
const TEXT = { coding: 'SQL', dragdrop: '⇅' };

/* An unnamed type is drawn as itself rather than as something else. Three characters is
 * what the badge holds, and seeing `SUR` on a hypothetical `survey` row is a prompt to come
 * and add it here - which is what `SQL` on a Python row failed to be. */
const label = type => (type ? String(type).slice(0, 3).toUpperCase() : '?');

/**
 * What to put in the badge for a row: `{ icon }` to draw, `{ text }` to typeset.
 *
 * Never both, so a caller cannot render one and silently fall back to the other.
 */
export const badgeFor = (row, done) => {
  // Slides are taught, not graded, so they never carry a tick however many times the
  // student walks past them.
  if (row.kind === 'slides') return { icon: ICONS.slides };
  if (done) return { text: '✓' };
  return ICONS[row.type] ? { icon: ICONS[row.type] }
                         : { text: TEXT[row.type] || label(row.type) };
};
