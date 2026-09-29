/* WHAT A PYTHON EDITOR IS BEING ASKED TO COMPLETE, from the text before the caret.
 *
 * Pure, like `walk.js` and `csv.js`, so test/pycomplete.mjs imports it directly. It lives
 * here rather than in the Python bridge because a regex written there sits inside a
 * JavaScript template literal, where a backslash is an escape before Python ever sees it.
 * So the question is worked out on this side, and Python is only ever asked one of three
 * plain things - see `_ice_complete` in python.js:
 *
 *   ['key',  'homelessness', 'st']   inside homelessness["st   - a column or a dict key
 *   ['attr', 'homelessness', 'he']   after homelessness.he      - a method, a column
 *   ['name', '',             'hom']  a bare word                - what the setup defined
 *
 * `node` is the syntax node the caret is in, by name. A comment asks for nothing, and a
 * string asks for nothing unless it is a subscript's key.
 */
const DOTTED = '[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*';
const IN_KEY = new RegExp(`(${DOTTED})\\[\\s*["']([^"']*)$`);
const AFTER_DOT = new RegExp(`(${DOTTED})\\.(\\w*)$`);
const BARE = /(?:^|[^\w.])([A-Za-z_]\w*)$/;

export function askFor(before, node = '', explicit = false) {
  if (node === 'Comment') return null;
  let m;
  if ((m = IN_KEY.exec(before))) return ['key', m[1], m[2]];
  if (/String/.test(node)) return null;
  if ((m = AFTER_DOT.exec(before))) return ['attr', m[1], m[2]];
  if ((m = BARE.exec(before))) return ['name', '', m[1]];
  // Ctrl+Space on nothing at all: everything the setup defined.
  if (explicit && !/[\w.]$/.test(before)) return ['name', '', ''];
  return null;
}
