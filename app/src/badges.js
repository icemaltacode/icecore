/* The little square beside an exercise, in the sidebar and in the Contents modal.
 *
 * Shared rather than written twice: the two lists sit side by side on screen, and a badge
 * that disagrees between them reads as a different exercise rather than the same one.
 */
const BY_TYPE = { mcq: '?', dragdrop: '⇅' };

export const badgeFor = (exercise, done) =>
  done ? '✓' : (BY_TYPE[exercise.type] || 'SQL');
