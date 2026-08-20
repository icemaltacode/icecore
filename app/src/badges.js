/* The little square beside a row, in the sidebar and in the Contents modal.
 *
 * Shared rather than written twice: the two lists sit side by side on screen, and a badge
 * that disagrees between them reads as a different exercise rather than the same one.
 */
const BY_TYPE = { mcq: '?', dragdrop: '⇅' };

export const badgeFor = (row, done) =>
  // Slides are taught, not graded, so they never carry a tick however many times the
  // student walks past them.
  row.kind === 'slides' ? '▶'
    : done ? '✓'
    : (BY_TYPE[row.type] || 'SQL');
