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
  /* STILL PARSED, AND NO LONGER OBEYED. The import calls out a file that has one rather than
   * ignoring it silently, which it can only do if the column is still recognised here. */
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
 * The template, with the real cohort names in it.
 *
 * THERE IS NO COURSE COLUMN. A course reaches somebody through the intake they are in, so
 * the only thing this file decides is which class each person joins - and the courses are
 * listed underneath anyway, as a legend saying which cohort takes what. That is what a tutor
 * is actually checking when they fill this in: not "did I spell the course id right" but
 * "will these people land on the right material".
 *
 * Listing the cohorts matters more than the header does, and for a stronger reason than the
 * course ids ever had: a course id at least exists to be got wrong, where a cohort name
 * typed slightly differently is CREATED - so a class splits quietly in two rather than
 * failing loudly, and the half in the new cohort is on nothing. The import previews that,
 * and this is the copy that stops it happening in the first place.
 *
 * The example rows are commented out for the same kind of reason - a template that imports
 * two fictional students on its first use is worse than one that imports nothing.
 */
export function templateCsv(courses, cohorts = []) {
  const example = cohorts[0]?.id || 'sept-2026-evening';
  const rows = [
    ['email', 'name', 'cohort', 'admin'],
    ['# jane.borg@example.com', 'Jane Borg', example, 'no'],
    ['# sam.grech@example.com', 'Sam Grech', example, 'no'],
  ];
  const title = id => courses.find(c => c.id === id)?.title || id;
  /* Each cohort with what it takes beside it, because the two facts are only useful
   * together: a name on its own does not tell a tutor whether this is the class they mean. */
  const classes = cohorts.length
    ? cohorts.map(c => {
      const on = (c.courses || []).map(title).join(', ');
      return `# ${c.id}  -  ${c.title}  -  ${on || '(no course yet)'}`;
    }).join('\r\n')
    : '# (none yet - whatever you type here is created, and takes no course until you give it one)';
  /* The legend goes UNDER the data, not above it: a comment line before the header makes
   * the header row the second line, and every spreadsheet then imports the file with the
   * comment as its column names. */
  return toCsv(rows)
    + '\r\n# The two rows above start with a # and are ignored - they show the shape.\r\n'
    + '# The cohort column takes one name, or several separated by a semicolon.\r\n'
    + '# A cohort is what puts somebody on a course. These exist:\r\n'
    + classes + '\r\n'
    + '#\r\n# A name that is not one of these creates a new cohort, taking no course.\r\n'
    + '# Give it one in Cohorts afterwards, or everybody in it signs in to an empty grid.\r\n';
}
