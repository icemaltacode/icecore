/* The import parser, on the files it will actually be handed.
 *
 * Cheap and worth having: a spreadsheet export is the one input to this platform nobody
 * writes by hand, and every failure here is silent - a mis-split row invites the wrong
 * address, a mis-read course column invites a class onto nothing. */
import { parseCsv, parseUsers, templateCsv } from '../app/src/csv.js';

let failures = 0;
// The detail is printed only on a failure - a green run should be readable at a glance.
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const eq = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

// ------------------------------------------------------------------ the parser
eq('plain rows', parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
eq('CRLF, as Excel writes it', parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
eq('a quoted comma stays one field', parseCsv('name,x\n"Borg, Jane",1\n'),
   [['name', 'x'], ['Borg, Jane', '1']]);
eq('doubled quotes are one quote', parseCsv('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
eq('a newline inside quotes is not a row', parseCsv('a,b\n"one\ntwo",3\n'),
   [['a', 'b'], ['one\ntwo', '3']]);
eq('blank lines are spacing, not records', parseCsv('a\n\n\nb\n'), [['a'], ['b']]);
eq('no trailing newline is still a row', parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
eq('empty fields survive', parseCsv('a,b,c\n1,,3\n'), [['a', 'b', 'c'], ['1', '', '3']]);

// ------------------------------------------------------------------- the users
{
  const { rows, error } = parseUsers(
    'Email,Full Name,Course,Admin\r\n'
    + 'A@B.com,"Borg, Jane",da-python;da-sql,yes\r\n'
    + 'nonsense,Sam,,\r\n'
    + 'a@b.com,Repeat,,\r\n'
    + 'c@d.com,,da-python,\r\n');
  check('a usable file has no file-level error', error === '', error);
  check('headings are matched by alias, case-insensitively', rows[0].name === 'Borg, Jane');
  check('the address is lower-cased', rows[0].email === 'a@b.com');
  eq('courses split on the semicolon', rows[0].courses, ['da-python', 'da-sql']);
  check('admin reads yes as true', rows[0].admin === true);
  check('a bad address is a row problem, not a file problem', rows[1].problem === 'Not an email address');
  check('a repeat inside one file is caught', rows[2].problem === 'Repeated in this file');
  check('the line number is the one in the file', rows[2].line === 4, String(rows[2].line));
  check('a good row after a bad one still parses', rows[3].email === 'c@d.com');
  check('every row is returned, good and bad', rows.length === 4, String(rows.length));
}

check('a file with no email column fails as a whole',
      /No email column/.test(parseUsers('name,thing\nJane,1\n').error));
check('an empty file says so', !!parseUsers('').error);

// A `#` row is a comment. The template ends with the course legend written that way, so
// this is what stops the file the screen hands out from failing its own import.
eq('comment rows are skipped', parseUsers('email\n# a note\nx@y.com\n').rows.map(r => r.email),
   ['x@y.com']);

{
  const courses = [{ id: 'da-python', title: 'Data Analyst (Python)' },
                   { id: 'da-sql', title: 'Data Analyst (SQL)' }];
  const cohorts = [{ id: 'sept-eve', title: 'Sept evening', courses: ['da-sql'] },
                   { id: 'oct-day', title: 'Oct daytime', courses: [] }];
  const template = templateCsv(courses, cohorts);
  /* THE COHORTS ARE WHAT IT HAS TO NAME NOW, not the course ids. A cohort typed slightly
   * differently is created rather than refused, so the legend is the only thing standing
   * between a typo and a class split quietly in two. */
  check('the template names every cohort id',
        cohorts.every(c => template.includes(c.id)));
  check('and says what each one takes, by title',
        template.includes('Data Analyst (SQL)'));
  /* An intake with no course yet is the state that most needs saying: everybody imported
   * into it signs in to an empty grid, and nothing else in the file would tell them. */
  check('and says when one takes nothing', template.includes('(no course yet)'));
  check('the template has no course column', !/^email,name,courses/m.test(template));
  eq('the template imports as zero rows - the examples are commented out',
     parseUsers(template).rows, []);
  check('the template has no file-level error either', parseUsers(template).error === '');
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
