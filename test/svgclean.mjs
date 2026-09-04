/* The filter, against the things it exists to stop.
 *
 * Every case below is a string that could arrive on the socket or come back out of a saved
 * board, and the assertion is always the same shape: the drawing survives and the weapon
 * does not. Worth having as a test rather than as care, because the failures are silent -
 * a filter that quietly stops filtering looks exactly like one that is working.
 *
 * jsdom for `DOMParser` only. The module is otherwise pure; this is the one browser thing
 * it asks for, and it asks for it because the sink it protects is `innerHTML`.
 */
import { JSDOM } from 'jsdom';
import { clean } from '../app/src/svgclean.js';

globalThis.DOMParser = new JSDOM('', { url: 'https://icecore.test/' }).window.DOMParser;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const has = (label, svg, needle) => check(label, clean(svg).includes(needle),
  `${needle} missing from ${clean(svg)}`);
const gone = (label, svg, needle) => check(label, !clean(svg).includes(needle),
  `${needle} survived in ${clean(svg)}`);

// ------------------------------------------------------------- a drawing survives
{
  /* What drauu actually emits for a stylus stroke, a shape and an arrow, shortened. */
  const drawing = '<path d="M0,0L10,10" fill="none" stroke="#f00" stroke-width="4" '
    + 'stroke-linecap="round" data-drauu_index="0"></path>'
    + '<rect x="5" y="6" width="20" height="30" rx="2" fill="transparent" stroke="#00f" '
    + 'stroke-width="2" stroke-dasharray="4 4" data-drauu_index="1"></rect>'
    + '<ellipse cx="1" cy="2" rx="3" ry="4" fill="transparent" stroke="#0f0"></ellipse>'
    + '<g><defs><marker id="a1" viewBox="0 -5 10 10" refX="5" refY="0" markerWidth="4" '
    + 'markerHeight="4" orient="auto"><path fill="#f00" d="M0,-5L10,0L0,5"></path></marker>'
    + '</defs><line x1="0" y1="0" x2="9" y2="9" stroke="#f00" marker-end="url(#a1)"></line></g>';

  const out = clean(drawing);
  has('a stylus path survives', drawing, 'd="M0,0L10,10"');
  has('and its index, which the op stack is restored from', drawing, 'data-drauu_index="0"');
  has('a rectangle survives, dashes and all', drawing, 'stroke-dasharray="4 4"');
  has('an ellipse survives', drawing, 'cx="1"');
  has('the arrowhead marker survives, camel case intact', drawing, 'markerWidth="4"');
  has('and the reference to it', drawing, 'marker-end="url(#a1)"');
  check('nesting is preserved', /<g><defs><marker[^>]*><path[^>]*\/><\/marker><\/defs><line/.test(out),
        out);
  check('filtering twice is filtering once', clean(out) === out);
}

// ------------------------------------------------------------- the weapons
gone('an inline event handler does not survive',
     '<rect x="1" onmouseover="alert(1)" stroke="#f00"/>', 'onmouseover');
has('but the rectangle it rode in on does',
    '<rect x="1" onmouseover="alert(1)" stroke="#f00"/>', 'x="1"');
check('an image with onerror is not an element we draw with',
      clean('<image href="x" onerror="alert(1)"/>') === '');
check('a script is dropped whole', clean('<script>alert(1)</script>') === '');
check('so is foreignObject, and the HTML inside it',
      clean('<foreignObject><iframe src="//evil"></iframe></foreignObject>') === '');
check('and an anchor, javascript: or not',
      clean('<a href="javascript:alert(1)"><rect x="1"/></a>') === '');
gone('a use element cannot reach back into the document',
     '<use href="#x"/>', 'use');
check('a marker-end that is not a fragment reference is refused',
      !clean('<line x1="0" marker-end="url(javascript:alert(1))"/>').includes('marker-end'));
check('an id that is not one of drauu\'s guids is refused',
      !clean('<marker id="a b&quot;c"/>').includes('id='));
gone('a foreign data attribute is not carried', '<rect data-evil="x" x="1"/>', 'data-evil');
gone('nor is style', '<rect style="background:url(//evil)" x="1"/>', 'style');
gone('nor a namespaced attribute', '<rect xlink:href="//evil" x="1"/>', 'href');

// ------------------------------------------------------------- shapes of nonsense
check('an unparseable string is an empty page, not a smaller drawing',
      clean('<rect x="1"') === '' || !clean('<rect x="1"').includes('evil'));
check('nothing in is nothing out', clean('') === '' && clean(null) === ''
      && clean(undefined) === '' && clean(42) === '');
check('an unclosed tag cannot swallow what follows it',
      !clean('<rect x="1"><script>alert(1)</script>').includes('alert'));
check('a quote in a value cannot end the attribute',
      !/stroke="[^"]*"[a-z]+=/.test(clean('<rect stroke=\'a" onload="alert(1)\' x="1"/>')));
check('a bracket in a value is escaped rather than reopened',
      !clean('<rect stroke="&lt;script&gt;" x="1"/>').includes('<script'));

// ------------------------------------------------------------- the bounds
{
  const deep = '<g>'.repeat(40) + '<rect x="1"/>' + '</g>'.repeat(40);
  const out = clean(deep);
  check('nesting is capped rather than followed',
        (out.match(/<g>/g) || []).length <= 4, `${(out.match(/<g>/g) || []).length} levels`);
  const many = '<rect x="1"/>'.repeat(30000);
  check('and so is the number of nodes',
        (clean(many).match(/<rect/g) || []).length === 20000);
  check('a single enormous value is dropped, not carried',
        !clean(`<path d="${'M0,0'.repeat(30000)}" stroke="#f00"/>`).includes('d='));
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
