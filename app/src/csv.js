/* CSV, for the one place the platform meets a spreadsheet: bulk-inviting a class.
 *
 * Pure and dependency-free, like compare.js and dragdrop.js. Nothing here touches the DOM
 * or the network - it turns text into rows and rows into text, and the import screen
 * decides what to do about it.
 *
 * A real parser rather than `split(',')`, because the input is a file somebody exported
 * from Excel: a name is quite often "Borg, Jane", quotes are doubled inside quotes, and
 * Excel writes CRLF. Getting any of those wrong turns one bad row into a whole failed
 * import that reads as the file being fine.
 */

/**
 * Split CSV text into rows of strings. Blank lines are dropped; a trailing newline is not
 * a row. Handles quoted fields, doubled quotes inside them, and CR, LF or CRLF endings.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let seen = false;   // whether this field exists at all - tells "" apart from end-of-row

  const endField = () => { row.push(field); field = ''; seen = false; };
  const endRow = () => {
    endField();
    // A line that is entirely empty is spacing, not a record. One that holds only commas
    // is a record of empty fields, and the caller gets to reject it with a row number.
    if (row.some(c => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !seen) { quoted = true; seen = true; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); continue; }
    if (c === '\n') { endRow(); continue; }
    field += c;
    seen = true;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Quote a value only where it needs it, the way a spreadsheet would. */
const quote = v => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Rows of arrays back to CSV text. CRLF, because the reader is usually Excel. */
export const toCsv = rows => rows.map(r => r.map(quote).join(',')).join('\r\n') + '\r\n';

/* The header names this understands, each mapped to the field it fills. Aliases exist
 * because the file comes from whatever the tutor already had - a column called "Full Name"
 * or "E-mail" is not a mistake worth failing an import over. */
const HEADINGS = {
  email: 'email', 'e-mail': 'email', 'email address': 'email', address: 'email',
  name: 'name', 'full name': 'name', fullname: 'name', student: 'name',
  courses: 'courses', course: 'courses', 'course ids': 'courses', enrol: 'courses', enroll: 'courses',
  cohort: 'cohorts', cohorts: 'cohorts', class: 'cohorts', group: 'cohorts', intake: 'cohorts',
  admin: 'admin', 'is admin': 'admin', administrator: 'admin',
};

const TRUE = new Set(['y', 'yes', 'true', '1', 'admin', 'x', '✓']);

const normalise = h => h.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^﻿/, '');

/* One course id per entry, however the column separated them. Not on a comma: the file is
 * comma-delimited, so a course list that used one is already two fields by the time it gets
 * here - which is exactly why the template uses a semicolon. */
const splitCourses = v => String(v || '').split(/[;|\s]+/).map(s => s.trim()).filter(Boolean);

/* Cohorts split on the separators ONLY, never on whitespace. A course id cannot contain a
 * space and a cohort name almost always does - "Sept 2026 evening" through `splitCourses`
 * is three cohorts, two of which get created on the spot. */
const splitCohorts = v => String(v || '').split(/[;|]+/).map(s => s.trim()).filter(Boolean);

/**
 * Parse an import file into `{ rows, error }`.
 *
 * Every row carries its own `line` and its own `problem`, rather than the whole file
 * failing on the first bad address: an import of thirty students with one typo should
 * invite the twenty-nine and say which one to fix.
 *
 * `error` is set only where the file as a whole is unusable - no header, or no email
 * column - because that is not something a per-row message can explain.
 */
export function parseUsers(text) {
  const raw = parseCsv(text);
  if (!raw.length) return { rows: [], error: 'That file has nothing in it.' };

  const header = raw[0].map(normalise);
  const columns = header.map(h => HEADINGS[h]);
  if (!columns.includes('email')) {
    return {
      rows: [],
      error: `No email column. The first line has to name the columns - "${header.join(', ')}" `
           + 'does not include one. Download the template to see the shape.',
    };
  }

  const at = (cells, field) => {
    const i = columns.indexOf(field);
    return i === -1 ? '' : (cells[i] || '').trim();
  };

  const seen = new Set();
  /* A line whose first cell opens with `#` is a comment, not a student. The template ends
   * with the list of course ids written that way, so without this the file it hands out
   * fails its own import - and the header is unreachable from a comment because a comment
   * above it would be read as the column names instead. */
  const rows = raw
    .map((cells, i) => ({ cells, line: i + 1 }))
    .slice(1)
    .filter(({ cells }) => !(cells[0] || '').trim().startsWith('#'))
    .map(({ cells, line }) => {
    const email = at(cells, 'email').toLowerCase();
    const row = {
      line,                             // the line number in the file the tutor is looking at
      email,
      name: at(cells, 'name'),
      courses: splitCourses(at(cells, 'courses')),
      cohorts: splitCohorts(at(cells, 'cohorts')),
      admin: TRUE.has(at(cells, 'admin').toLowerCase()),
      problem: '',
    };
    // Deliberately loose: this is a sanity check against a mis-parsed file, not an attempt
    // to decide what a valid address is. Cognito is the authority and it will say so.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) row.problem = 'Not an email address';
    else if (seen.has(email)) row.problem = 'Repeated in this file';
    else seen.add(email);
    return row;
  });

  return { rows, error: '' };
}

/**
 * The template, with the real course ids in it.
 *
 * Listing them matters more than the header does: a tutor cannot guess that a course is
 * called `data-analyst-sql`, and an import whose course column is quietly wrong succeeds,
 * says nothing, and leaves a class with no courses on their grid. The example rows are
 * commented out for exactly that reason - a template that imports two fictional students
 * on its first use is worse than one that imports nothing.
 */
export function templateCsv(courses, cohorts = []) {
  const ids = courses.map(c => c.id);
  const example = cohorts[0]?.id || 'sept-2026-evening';
  const rows = [
    ['email', 'name', 'courses', 'cohort', 'admin'],
    ['# jane.borg@example.com', 'Jane Borg', ids.slice(0, 2).join(';'), example, 'no'],
    ['# sam.grech@example.com', 'Sam Grech', ids[0] || '', example, 'no'],
  ];
  const legend = courses.length
    ? courses.map(c => `# ${c.id}  -  ${c.title}`).join('\r\n')
    : '# (no courses published yet)';
  /* Cohorts are listed the same way and for a stronger reason: a course id at least exists
   * to be got wrong, where a cohort typed slightly differently is CREATED - so a class
   * splits quietly in two rather than failing loudly. The import previews that, and this is
   * the copy that stops it happening in the first place. */
  const classes = cohorts.length
    ? cohorts.map(c => `# ${c.id}  -  ${c.title}`).join('\r\n')
    : '# (none yet - whatever you type here is created)';
  /* The legend goes UNDER the data, not above it: a comment line before the header makes
   * the header row the second line, and every spreadsheet then imports the file with the
   * comment as its column names. */
  return toCsv(rows)
    + '\r\n# The two rows above start with a # and are ignored - they show the shape.\r\n'
    + '# Separate several courses with a semicolon. The course ids are:\r\n'
    + legend + '\r\n'
    + '#\r\n# The cohort column takes one name, or several separated by a semicolon.\r\n'
    + '# A name that is not one of these creates a new cohort:\r\n'
    + classes + '\r\n';
}
