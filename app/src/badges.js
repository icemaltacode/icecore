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
const MCQ = `
  <circle cx="4" cy="4.75" r="2.15" fill="currentColor" stroke="none"/>
  <circle cx="4" cy="11.25" r="2.15"/>
  <path d="M8.75 4.75h5.25M8.75 11.25h5.25"/>`;

/* A screen on a stand. Deliberately NOT a play triangle and NOT a film frame: the row is a
 * run of slides to read through, and every video-ish glyph promises something that plays. */
const SLIDES = `
  <rect x="1.75" y="2.25" width="12.5" height="8.5" rx="1.5"/>
  <path d="M8 10.75V13.5M5.5 13.5h5"/>`;

const ICONS = { mcq: MCQ, slides: SLIDES };

/* The language a coding exercise is written in, because that is the thing a student is
 * deciding when they look at the row - SQL and Python are different work.
 *
 * Every type is named. `coding` used to be the DEFAULT rather than an entry, so `python`
 * fell through it and 313 Python exercises wore an SQL badge in both lists. A default that
 * names a specific language is a default that lies about every type added after it. */
const TEXT = { coding: 'SQL', python: 'PY', dragdrop: '⇅' };

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
