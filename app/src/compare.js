/* Pure result-set comparison - no imports, so build scripts and tests can use it
 * without pulling in the browser-only content loader. */
const norm = v => v === null || v === undefined ? ' NULL'
  : typeof v === 'number' ? String(v)
  : v instanceof Date ? v.toISOString()
  : String(v);

const rowKey = (row, fields) => fields.map(f => norm(row[f])).join('');

export const isDDL = q => /\b(create|drop|alter|insert|update|delete|truncate)\b/i.test(q);

/**
 * Pure comparison of a student's result set against the expected one that
 * build-content.mjs computed from the reference solution.
 *
 * Row order matters only when the solution contains ORDER BY; otherwise rows are
 * compared as a multiset.
 */
export function compareResults(expected, actual) {
  if (actual.fields.length !== expected.fields.length)
    return { pass: false, result: actual,
             reason: `Expected ${expected.fields.length} column${expected.fields.length === 1 ? '' : 's'}, your query returned ${actual.fields.length}.` };

  if (expected.fields.some((f, i) => f.toLowerCase() !== actual.fields[i]?.toLowerCase()))
    return { pass: false, result: actual,
             reason: `Column names don't match - expected ${expected.fields.join(', ')} but got ${actual.fields.join(', ')}.` };

  if (actual.rows.length !== expected.rowCount)
    return { pass: false, result: actual,
             reason: `Expected ${expected.rowCount} row${expected.rowCount === 1 ? '' : 's'}, your query returned ${actual.rows.length}.` };

  // A step whose solution calls now(), random() or similar cannot have its values checked:
  // the expected set was computed at build time and the student's runs minutes or months
  // later, so the two can only ever agree on shape. Marked per step in the markdown, not
  // guessed from the SQL - `now()` in a WHERE clause may still give a fixed result set,
  // and a query with no volatile call at all can still be non-deterministic.
  if (expected.nondeterministic)
    return { pass: true, result: actual, reason: 'Correct - right columns and row count.' };

  // expected.rows is capped for size; past the cap, columns and counts are all we can check
  const cap = expected.rows.length;
  const a = expected.rows.map(r => rowKey(r, expected.fields));
  const b = actual.rows.slice(0, cap).map(r => rowKey(r, actual.fields));
  if (!expected.ordered) { a.sort(); b.sort(); }

  const badAt = a.findIndex((x, i) => x !== b[i]);
  if (badAt !== -1)
    return { pass: false, result: actual,
             reason: expected.ordered
               ? `Right columns, but row ${badAt + 1} isn't what's expected - check your ordering.`
               : `Right shape, but the values don't match (first difference at row ${badAt + 1}).` };

  return { pass: true, result: actual, reason: 'Correct.' };
}
