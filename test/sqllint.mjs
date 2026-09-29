/* What is wrong with a query, asked of Postgres without running it - see app/src/sqllint.js.
 * The splitting is pure; the checking runs against a real PGlite, because the whole promise
 * is that a red line means the database itself would refuse the query. */
import { PGlite } from '@electric-sql/pglite';
import { splitSql, lintSql } from '../app/src/sqllint.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- splitting
{
  const texts = s => splitSql(s).map(x => x.text);
  check('one statement', JSON.stringify(texts('SELECT 1;')) === '["SELECT 1"]');
  check('two, with their offsets', JSON.stringify(splitSql('SELECT 1;\n  SELECT 2'))
        === '[{"text":"SELECT 1","from":0},{"text":"SELECT 2","from":12}]',
        JSON.stringify(splitSql('SELECT 1;\n  SELECT 2')));
  check('a semicolon in a string does not split',
        texts("SELECT ';' AS x; SELECT 2").length === 2);
  check('nor in a doubled quote', texts("SELECT 'it''s; fine'").length === 1);
  check('nor in a quoted name', texts('SELECT 1 AS "a;b"').length === 1);
  check('nor in a comment', texts('SELECT 1 -- a; b\n, 2').length === 1);
  check('nor in a nested block comment', texts('SELECT /* a /* b; */ c; */ 1').length === 1);
  check('nor in a dollar-quoted body', texts('SELECT $x$ a; b $x$').length === 1);
  check("nor in an E'' string with an escaped quote", texts("SELECT E'a\\';b'").length === 1);
  check('a statement that is only a comment is not one',
        JSON.stringify(texts('SELECT 1;\n-- the end\n')) === '["SELECT 1"]');
}

// ---------------------------------------------------------------- checking
const db = new PGlite();
await db.exec(`CREATE TABLE orders (id int, total numeric);
               CREATE TABLE shop (id int, city text);`);
const lint = async text => (await lintSql(db, text)).map(d => ({ ...d, word: text.slice(d.from, d.to) }));

{
  check('a query that would run is not marked', (await lint('SELECT id, total FROM orders;')).length === 0);

  const col = await lint('SELECT totl FROM orders');
  check('an unknown column is marked, on the column', col[0]?.word === 'totl'
        && /column "totl" does not exist/.test(col[0]?.message), JSON.stringify(col));

  const tbl = await lint('SELECT *\nFROM ordrs');
  check('an unknown table is marked, on the table', tbl[0]?.word === 'ordrs', JSON.stringify(tbl));

  const typo = await lint('SELEC * FROM orders');
  check('a typo in the first keyword is marked, not skipped', typo[0]?.word === 'SELEC',
        JSON.stringify(typo));

  const end = await lint('SELECT * FROM orders WHERE');
  check('running out of text marks the last word', end[0]?.word === 'WHERE'
        && /end of input/.test(end[0]?.message), JSON.stringify(end));

  const second = await lint('SELECT 1;\nSELECT cty FROM shop;');
  check('the second statement is marked where it is', second.length === 1
        && second[0].word === 'cty' && second[0].from === 17, JSON.stringify(second));

  const noPos = await lint('SELECT 1/0');
  check('an error with no position marks the first word', noPos[0]?.word === 'SELECT',
        JSON.stringify(noPos));

  // CREATE VIEW cannot be planned, and what follows may use what it makes.
  const view = await lint('CREATE VIEW big AS SELECT * FROM orders;\nSELECT * FROM big;');
  check('nothing after a statement Postgres cannot plan is checked', view.length === 0,
        JSON.stringify(view));

  const quiet = await lint('INSERT INTO orders VALUES (1, 2);\nDELETE FROM orders;');
  const rows = (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
  check('a data change is checked and never run', quiet.length === 0 && rows === 0,
        `diagnostics=${JSON.stringify(quiet)} rows=${rows}`);

  // A Run the student left in an aborted transaction says nothing about this code.
  await db.exec('BEGIN;').catch(() => {});
  await db.exec('SELECT nope;').catch(() => {});
  const aborted = await lint('SELECT id FROM orders');
  await db.exec('ROLLBACK;').catch(() => {});
  check('an aborted transaction is not blamed on the query', aborted.length === 0,
        JSON.stringify(aborted));
}
await db.close();

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
