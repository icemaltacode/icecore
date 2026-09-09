/* WHAT RUN ACTUALLY RUNS.
 *
 * Every editor a student has ever used runs the highlighted lines when there are some, and
 * this one ran the whole file regardless - so trying one line of a query meant commenting
 * out the rest and remembering to put it back. Check is untouched and must be: it grades a
 * SUBMISSION, and marking somebody on a fragment they never submitted would be a wrong
 * verdict rather than a smaller one.
 *
 * PURE AND DEPENDENCY-FREE, like `compare.js` and `walk.js`, and here for `walk.js`'s reason
 * rather than for the six lines: the SQL exercise and the Python one both have a Run button,
 * and two readings of "what is selected" would mean Run meaning different things in two
 * halves of the same course. It is also the whole of the feature that can be tested without
 * a browser, which is the other half of why it is not inline in the components.
 *
 * WHOLE LINES, ALWAYS. A selection that starts mid-line is extended to cover the lines it
 * touches, which is what every editor does and the only reading that can be executed: half a
 * statement is not a smaller statement, and the fragment a drag happens to end on is not
 * something a student meant to run on its own.
 *
 * AND DEDENTED, which matters in exactly one language and costs nothing in the other. Python
 * refuses a block lifted out of a loop with `IndentationError: unexpected indent` - a
 * complaint about the act of selecting rather than about the code - and SQL does not care
 * about leading whitespace at all. The common prefix goes, so what is INSIDE the selection
 * keeps its shape.
 *
 * BLANK IS NOTHING. A stray drag leaves a selection of two spaces, and running that is a
 * no-op the student pressed a button for. Null here means the button says "Run code" and
 * runs the buffer, which is the honest answer to a selection that holds no code.
 */

/** The indentation the whole block shares, so removing it cannot change what is nested. */
const commonIndent = lines => {
  let prefix = null;
  for (const line of lines) {
    if (!line.trim()) continue;   // a blank line indents nothing and must not vote
    const indent = line.slice(0, line.length - line.trimStart().length);
    if (prefix === null) { prefix = indent; continue; }
    let i = 0;
    while (i < prefix.length && i < indent.length && prefix[i] === indent[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix || '';
};

/**
 * The code a selection asks to run, or null when it asks for nothing.
 *
 * `head` and `anchor` are the two ends as the editor reports them, in either order. A bare
 * caret is an anchor equal to the head - or a null anchor, which is how the exercise
 * components already spell it - and selects nothing.
 */
export function selectedCode(code, head, anchor) {
  if (typeof code !== 'string' || head == null || anchor == null) return null;
  let from = Math.max(0, Math.min(Number(head), Number(anchor)));
  let to = Math.min(code.length, Math.max(Number(head), Number(anchor)));
  if (!(to > from)) return null;
  // Out to the line boundaries either side. `lastIndexOf` from `from - 1` so a selection
  // that already starts at a newline is not dragged back through the line before it.
  from = code.lastIndexOf('\n', from - 1) + 1;
  const end = code.indexOf('\n', to);
  to = end === -1 ? code.length : end;

  const lines = code.slice(from, to).split('\n');
  const prefix = commonIndent(lines);
  const text = (prefix ? lines.map(l => (l.startsWith(prefix) ? l.slice(prefix.length) : l.trimStart())) : lines)
    .join('\n');
  return text.trim() ? text : null;
}
