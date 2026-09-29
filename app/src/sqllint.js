/* WHAT IS WRONG WITH A QUERY, asked of Postgres itself - without running it.
 *
 * Pure apart from the database it is handed, like `compare.js`, so test/sqllint.mjs runs it
 * against a real PGlite in Node. db.js hands it the student's own database for the exercise,
 * which is the right one to ask: a view they created in step 1 exists there, and the dataset's
 * tables are exactly what their Run will see.
 *
 * EXPLAIN, NEVER THE STATEMENT. Postgres parses, resolves every name and plans an EXPLAIN,
 * and executes nothing - so `column "totl" does not exist` comes back with the character it
 * is at, from the same engine that would have refused it on Run. A red line here means Run
 * would fail. That is the whole bar: a linter that is sometimes wrong teaches a beginner to
 * "fix" code that was fine.
 *
 * WHAT IT CANNOT PLAN, IT DOES NOT CHECK, and nothing after it either. EXPLAIN takes a query
 * or a data change - not CREATE VIEW, not ALTER - and a statement after a CREATE may be about
 * the thing it creates, which does not exist until the student runs it. Explained anyway,
 * that statement would be marked wrong for being right. So checking stops at the first
 * statement Postgres cannot plan.
 */

/* Statements EXPLAIN cannot take. Everything else is explained - including a statement that
 * begins with a typo, because `SELEC * FROM` is the commonest mistake of all and a list of
 * what CAN be explained would skip it. */
const UNPLANNABLE = new RegExp('^(create|alter|drop|truncate|grant|revoke|comment|set|reset|'
  + 'show|begin|start|commit|end|rollback|abort|savepoint|release|copy|do|call|analy[sz]e|'
  + 'vacuum|reindex|cluster|lock|refresh|prepare|deallocate|listen|notify|unlisten|discard|'
  + 'import|security|load|checkpoint)\\b', 'i');

/* Only errors a Run would also raise about THIS text: a syntax error or a name that does not
 * resolve (class 42), and a data error Postgres finds while planning, such as a literal that
 * divides by zero (class 22). A transaction the student's own Run left aborted (25P02) says
 * nothing about the code, and marking every line of it red would be a lie. */
const REPORTABLE = /^(42|22)/;

const PREFIX = 'EXPLAIN ';

/**
 * The statements in `text`, as `{ text, from }` with `from` its offset in the whole buffer.
 * Semicolons inside strings, quoted names, dollar-quoted bodies and comments do not split,
 * and a statement that is only comments is dropped rather than explained as nothing.
 */
export function splitSql(text) {
  const out = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  const push = end => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (stripComments(body).trim()) out.push({ text: body, from: start + lead });
  };
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      i = text.indexOf('\n', i);
      if (i === -1) i = n;
    } else if (c === '/' && next === '*') {
      i = endOfBlockComment(text, i);
    } else if (c === "'") {
      // E'...' takes backslash escapes; a plain string doubles its quotes.
      const escaped = /[eE]/.test(text[i - 1] || '') && !/[\w$]/.test(text[i - 2] || '');
      i = endOfQuoted(text, i, "'", escaped);
    } else if (c === '"') {
      i = endOfQuoted(text, i, '"', false);
    } else if (c === '$') {
      const tag = /^\$([A-Za-z_][\w]*)?\$/.exec(text.slice(i));
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? n : close + tag[0].length;
      } else i++;
    } else if (c === ';') {
      push(i);
      start = ++i;
    } else i++;
  }
  push(n);
  return out;
}

function endOfQuoted(text, i, q, escaped) {
  let j = i + 1;
  while (j < text.length) {
    if (escaped && text[j] === '\\') { j += 2; continue; }
    if (text[j] === q) {
      if (text[j + 1] === q) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return text.length;
}

// Postgres nests block comments, so the depth is counted rather than the first */ taken.
function endOfBlockComment(text, i) {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    if (text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; continue; }
    if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; if (!depth) return j; continue; }
    j++;
  }
  return text.length;
}

const stripComments = s => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The keyword a statement opens with, past comments and opening brackets. */
const opening = s => (/[A-Za-z_]+/.exec(stripComments(s).replace(/^[\s(]+/, '')) || [''])[0];

/**
 * `[{ from, to, message }]` for everything Postgres would refuse in `text`, checked against
 * `db` - anything with a `query(sql)` that throws Postgres's own errors. Offsets are into
 * `text`, ready to underline.
 */
export async function lintSql(db, text) {
  const found = [];
  for (const stmt of splitSql(text)) {
    if (UNPLANNABLE.test(opening(stmt.text))) break;
    try {
      await db.query(PREFIX + stmt.text);
    } catch (e) {
      if (!REPORTABLE.test(String(e?.code || ''))) continue;
      found.push({ ...rangeOf(stmt, Number(e.position) || 0), message: e.message });
    }
  }
  return found;
}

/* Where to underline: the word Postgres pointed at, or the last one when it ran out of text
 * ("syntax error at end of input"), or the statement's first word when it gave no position
 * at all. A single character is too small to see and the whole statement too much to read. */
function rangeOf(stmt, position) {
  const t = stmt.text;
  if (!position) {
    const first = /^\S+/.exec(t);
    return { from: stmt.from, to: stmt.from + (first ? first[0].length : t.length) };
  }
  let at = position - 1 - PREFIX.length;
  if (at >= t.length) {
    const last = /\S+\s*$/.exec(t);
    at = last ? last.index : Math.max(0, t.length - 1);
  }
  at = Math.max(0, at);
  const word = /^("[^"]*"?|[\w$]+)/.exec(t.slice(at));
  return { from: stmt.from + at, to: stmt.from + at + (word ? word[0].length : 1) };
}
