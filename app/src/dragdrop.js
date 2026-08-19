/* Drag-and-drop exercises: putting items into the right order, or sorting them into
 * named zones.
 *
 * Pure and dependency-free, like compare.js, so `icecore verify` can validate this
 * content and the player can grade it from the same rules. There is no SQL here and no
 * dataset — nothing to precompute, nothing to run.
 *
 *   mode 'order'     ex.items  = the correct sequence
 *   mode 'classify'  ex.zones  = [{ id, title, items }], plus ex.pool as the source label
 */

/** Every draggable item in an exercise, whichever mode it is. */
export const allItems = ex =>
  ex.mode === 'order' ? (ex.items || []) : (ex.zones || []).flatMap(z => z.items || []);

/**
 * Content-time checks. Returns a list of human-readable problems, empty when the
 * exercise is sound. `verify` fails the build on these.
 */
export function validate(ex) {
  const problems = [];
  const items = allItems(ex);

  if (ex.mode !== 'order' && ex.mode !== 'classify')
    problems.push(`mode must be "order" or "classify", got ${JSON.stringify(ex.mode)}`);
  if (items.length < 2) problems.push('needs at least two items');

  // Load-bearing, and not redundant with the id generator: grading matches placements to
  // items by id, so two items sharing one would grade as correct wherever they landed.
  const ids = items.map(i => i.id);
  for (const dupe of duplicates(ids)) problems.push(`item id "${dupe}" is used more than once`);
  for (const dupe of duplicates(items.map(i => i.content))) problems.push(`item "${dupe}" appears more than once`);
  for (const item of items) if (!item.content?.trim()) problems.push(`item "${item.id}" has no content`);

  if (ex.mode === 'classify') {
    if (!ex.zones?.length) problems.push('no zones - a classify exercise needs at least one');
    if ((ex.zones || []).length < 2) problems.push('needs at least two zones to sort between');
    for (const z of ex.zones || []) {
      if (!z.title?.trim()) problems.push(`zone "${z.id}" has no title`);
      if (!z.items?.length) problems.push(`zone "${z.title || z.id}" has no items`);
    }
    for (const dupe of duplicates((ex.zones || []).map(z => z.id)))
      problems.push(`zone id "${dupe}" is used more than once`);
  }
  return problems;
}

/**
 * Grade an attempt.
 *   order     response is an array of item ids, top to bottom
 *   classify  response is { [zoneId]: itemId[] }
 * The reason says how close they are without saying which items are wrong.
 */
export function check(ex, response) {
  return ex.mode === 'order' ? checkOrder(ex, response) : checkClassify(ex, response);
}

function checkOrder(ex, sequence = []) {
  const want = (ex.items || []).map(i => i.id);
  if (sequence.length !== want.length) return { pass: false, reason: 'Use every item.' };
  const right = sequence.filter((id, i) => id === want[i]).length;
  return right === want.length
    ? { pass: true, reason: 'Correct — that is the order.' }
    : { pass: false, reason: `Not yet — ${right} of ${want.length} ${right === 1 ? 'is' : 'are'} in the right place.` };
}

function checkClassify(ex, placement = {}) {
  const total = allItems(ex).length;
  const placed = Object.values(placement).flat().length;
  if (placed < total) return { pass: false, reason: `${total - placed} still to place.` };

  let right = 0;
  for (const zone of ex.zones || []) {
    const got = new Set(placement[zone.id] || []);
    for (const item of zone.items) if (got.has(item.id)) right++;
  }
  return right === total
    ? { pass: true, reason: 'Correct — every item is in the right group.' }
    : { pass: false, reason: `Not yet — ${right} of ${total} ${right === 1 ? 'is' : 'are'} in the right group.` };
}

const duplicates = xs => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
