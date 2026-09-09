/* WHAT RUN RUNS. Pure, so it is testable without a browser - which is most of why it is a
 * module rather than six lines in each of the two exercise components. */
import { selectedCode } from '../app/src/selection.js';

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) return console.log(`PASS  ${what}`);
  failures++;
  console.log(`FAIL  ${what}${saw === undefined ? '' : `  -- ${JSON.stringify(saw)}`}`);
};

const CODE = 'SELECT a\nFROM t\nWHERE x = 1';

// ------------------------------------------------------------- nothing selected
check('a bare caret selects nothing', selectedCode(CODE, 3, 3) === null);
check('and a null anchor is a bare caret', selectedCode(CODE, 3, null) === null);
check('so is a caret at the very start', selectedCode(CODE, 0, 0) === null);
check('a selection of only whitespace is nothing',
      selectedCode('a\n   \nb', 2, 5) === null, selectedCode('a\n   \nb', 2, 5));

// ------------------------------------------------------------------ whole lines
/* HALF A STATEMENT IS NOT A SMALLER STATEMENT. The fragment a drag happens to end on is not
 * something anybody meant to run, so the lines it touches are what runs. */
check('a selection inside one line runs that whole line',
      selectedCode(CODE, 11, 13) === 'FROM t', selectedCode(CODE, 11, 13));
check('and it reads the same dragged backwards',
      selectedCode(CODE, 13, 11) === 'FROM t', selectedCode(CODE, 13, 11));
check('a selection spanning two lines runs both whole',
      selectedCode(CODE, 3, 12) === 'SELECT a\nFROM t', selectedCode(CODE, 3, 12));
check('selecting everything runs everything', selectedCode(CODE, 0, CODE.length) === CODE);
/* A selection that stops exactly on a newline must not drag in the line before it - the
 * off-by-one that would make selecting line two run lines one and two. */
check('a selection ending on a line break stops there',
      selectedCode(CODE, 9, 15) === 'FROM t', selectedCode(CODE, 9, 15));

// --------------------------------------------------------------------- dedented
/* PYTHON REFUSES A BLOCK LIFTED OUT OF ITS LOOP, with a complaint about the act of selecting
 * rather than about the code. SQL does not care, so this costs nothing there. */
const LOOP = 'for x in xs:\n    print(x)\n    total += x\n';
check('a block lifted out of a loop is dedented',
      selectedCode(LOOP, 17, 40) === 'print(x)\ntotal += x', selectedCode(LOOP, 17, 40));
/* THE COMMON PREFIX ONLY, so what is nested inside the selection stays nested. Dedenting
 * every line to the margin would flatten the block into a syntax error. */
const NESTED = 'if a:\n    if b:\n        go()\n';
check('and only by what the whole block shares',
      selectedCode(NESTED, 8, 28) === 'if b:\n    go()', selectedCode(NESTED, 8, 28));
/* A blank line has no indentation and must not vote, or one empty line in the middle of a
 * block means nothing is dedented at all. */
const GAPPED = 'def f():\n    a = 1\n\n    return a\n';
check('a blank line inside the block does not hold the indent',
      selectedCode(GAPPED, 13, 32) === 'a = 1\n\nreturn a', selectedCode(GAPPED, 13, 32));

// ------------------------------------------------------------------ nonsense in
check('a range past the end of the buffer is clamped rather than fatal',
      selectedCode(CODE, 11, 9999) === 'FROM t\nWHERE x = 1', selectedCode(CODE, 11, 9999));
check('and nothing at all is nothing', selectedCode(null, 0, 5) === null);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
