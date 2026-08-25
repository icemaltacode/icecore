/* One page of a table, a file or a frame - whatever the student is browsing.
 *
 * THREE SOURCES, ONE ANSWER. A browse asks the same question of very different things: give
 * me rows `offset..offset+limit` of `name`, the ones matching `q`, plus how many there are
 * altogether and how many matched. What differs is who can answer it - Postgres for a
 * table, pandas for a frame, and plain JavaScript for a CSV - so the dispatch lives here and
 * every caller sees one shape.
 *
 * A CSV IS READ IN JAVASCRIPT, DELIBERATELY, and this is the point of the module. Pyodide
 * takes seconds to boot and the browser is most useful in exactly those seconds - it is how
 * a student decides what to load. Routing a CSV through the interpreter would make the pane
 * unavailable precisely when it is wanted. A .feather file has no such option and goes to
 * pandas; so does anything the student built themselves.
 *
 * SO BROWSING A FILE AND BROWSING A FRAME ARE NOT THE SAME QUESTION, and the split makes
 * that visible rather than hiding it. `mpg.csv` here is the bytes on disk; `mpg` after
 * `pd.read_csv` is what pandas made of them, which may have parsed a date, coerced a column
 * to float, or turned an empty field into NaN. That is a real difference and worth seeing -
 * it is not the DataGrid inconsistency that `DataGrid.vue` warns about, because these are
 * two different objects rather than two renderings of one.
 *
 * MATCHING IS A LITERAL, CASE-INSENSITIVE SUBSTRING in all three, and that had to be chosen
 * rather than inherited. Postgres would default to LIKE patterns, JavaScript to a regex and
 * pandas to a regex - so `100%` or `a.b` would find different rows depending on what the
 * student happened to be browsing. `strpos`, `includes` and `regex=False` are the three
 * spellings of the same rule.
 */
import { database } from './playground-db.js';
import { browse as pyBrowse } from './playground-py.js';

/* ---------------------------------------------------------------- CSV, in the browser */

/** RFC 4180, as much of it as these files use: quoted fields, doubled quotes, CRLF. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // a BOM would join the first header
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') { field += c; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Numbers become numbers, so the grid right-aligns them and a column of figures is readable.
 * Decided per COLUMN from every value in it, never per cell: a postcode column holding
 * "01234" beside "SW1A" must stay text throughout, and one that flipped per cell would be
 * aligned both ways down the same column. An empty field is null rather than "" - the file
 * says nothing there, and NULL is how this app renders nothing. */
const NUMERIC = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function typed(rows, fields) {
  const num = fields.map((_, i) =>
    rows.some(r => r[i] !== '' && r[i] != null)
    && rows.every(r => r[i] === '' || r[i] == null || NUMERIC.test(r[i])));
  return rows.map(r => Object.fromEntries(fields.map((f, i) => {
    const v = r[i];
    return [f, v === '' || v === undefined ? null : num[i] ? Number(v) : v];
  })));
}

/* Read once and kept, because a pager asks for the same file on every page and every
 * keystroke of a search. Keyed by URL, so the cache cannot outlive what it describes. */
const csvCache = new Map();

async function csvOf(url) {
  if (!csvCache.has(url)) csvCache.set(url, (async () => {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`cannot read this file (${r.status})`);
    const raw = parseCsv(await r.text());
    if (!raw.length) return { fields: [], rows: [] };
    // A duplicate header would silently swallow the first column - the rows are objects.
    const seen = {};
    const fields = raw[0].map(h => {
      const name = h.trim() || 'column';
      if (seen[name] === undefined) { seen[name] = 0; return name; }
      return `${name}.${++seen[name]}`;
    });
    return { fields, rows: typed(raw.slice(1), fields) };
  })().catch(e => { csvCache.delete(url); throw e; }));
  return csvCache.get(url);
}

function csvPage({ fields, rows }, { q, col, offset, limit }) {
  const which = col === null || col === undefined ? fields : [fields[col]];
  const needle = q.toLowerCase();
  const hits = q
    ? rows.filter(r => which.some(f => r[f] !== null && String(r[f]).toLowerCase().includes(needle)))
    : rows;
  return {
    fields, columns: fields,
    rows: hits.slice(offset, offset + limit),
    total: rows.length, matched: hits.length,
  };
}

/* ------------------------------------------------------------------- SQL, in Postgres */

const ident = n => `"${String(n).replace(/"/g, '""')}"`;
const lit = s => `'${String(s).replace(/'/g, "''")}'`;

async function sqlPage(item, { q, col, offset, limit }) {
  const db = await database();
  const names = item.columns.map(c => c.name);
  const t = ident(item.name);
  const which = col === null || col === undefined ? names : [names[col]];
  const where = q
    ? ` WHERE ${which.map(c => `strpos(lower(CAST(${ident(c)} AS text)), lower(${lit(q)})) > 0`).join(' OR ')}`
    : '';

  /* A PAGER NEEDS A STABLE ORDER, and a bare SELECT has none - Postgres may return the same
   * row on page 2 and page 3 and omit another entirely, which reads as the data being wrong.
   * `ctid` is the physical position, so a table pages in the order it was loaded, which is
   * what "browse this table" means. A view has no ctid; ordering it by every column is
   * deterministic instead, since any two rows that could still swap are identical. */
  const order = item.view ? `ORDER BY ${names.map((_, i) => i + 1).join(', ')}` : 'ORDER BY ctid';

  const total = Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
  const matched = q
    ? Number((await db.query(`SELECT count(*) AS n FROM ${t}${where}`)).rows[0].n)
    : total;
  const { fields, rows } = await db.query(
    `SELECT * FROM ${t}${where} ${order} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
  return { fields: fields.map(f => f.name), columns: names, rows, total, matched };
}

/* ------------------------------------------------------------------------- the front */

/**
 * One page of whatever `item` is.
 *
 * @param item  a rail entry: {kind:'table', name, view, columns} for SQL, or
 *              {kind:'file', name, url?} / {kind:'frame', name} for Python.
 * @param col   an INDEX into the source's columns, or null for every column. An index
 *              rather than a name because a frame may carry two columns of one name.
 */
export async function page(item, { q = '', col = null, offset = 0, limit = 100 } = {}) {
  const opts = { q, col, offset, limit };
  if (item.kind === 'table') return sqlPage(item, opts);
  // The fast path, and the only one that works before the interpreter is up.
  if (item.kind === 'file' && item.url && /\.csv$/i.test(item.name))
    return csvPage(await csvOf(item.url), opts);
  const r = await pyBrowse(item.kind, item.name, opts);
  return { fields: r.fields, columns: r.columns, rows: r.rows, total: r.total, matched: r.matched };
}

/** Forget the cached CSVs. Called by Reset, which unmounts the files they came from. */
export const forget = () => csvCache.clear();
