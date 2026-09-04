/* WHAT A DRAWING IS ALLOWED TO BE, before it is put into the DOM.
 *
 * A board and a slide annotation both arrive as an SVG STRING off the socket, and both are
 * applied by drauu's `load()`, which is `el.innerHTML = svg`. That parses markup and inserts
 * real nodes. An inserted `<script>` does not run - browsers refuse that - but plenty else
 * does:
 *
 *     <image href="x" onerror="...">        fires
 *     <rect onmouseover="...">              fires
 *     <foreignObject><iframe ...>           SVG can host HTML
 *     <a href="javascript:...">
 *
 * which is script execution in the PLAYER's origin, where the session and the CloudFront
 * signed cookies live. The sender is not arbitrary - `board`, `stroke` and `page` are gated
 * on being the session's tutor, exactly as `point` and `sync` are - but a saved board
 * PERSISTS AND REPLAYS, so a bad page sits in the rows and reaches every student who opens
 * the paperclip, months later and outside any lesson. That is what lifts this above
 * theoretical.
 *
 * VALIDATED AGAINST A CLOSED SET, NOT ESCAPED. Same reasoning pointer.js gives for a region
 * name: the vocabulary is short and entirely ours, so anything outside it is a message this
 * version does not understand rather than something to render carefully. The allowlist below
 * is taken from what drauu's own models emit, not from what SVG permits.
 *
 * REBUILT RATHER THAN PRUNED, and that is the difference between this being safe and being
 * nearly safe. Nothing from the input reaches the output except attribute VALUES, escaped:
 * every element name and every attribute name is written from the constants in this file. A
 * pruner forgets a case and passes it through; this one forgets a case and drops it.
 *
 * PARSED THE WAY THE SINK PARSES. The consumer assigns to `innerHTML` on an SVG element, so
 * this parses the same string as HTML inside an `<svg>` - the same algorithm, with the same
 * foreign-content rules and the same attribute-case adjustments. Parsing it as XML instead
 * would filter a document subtly different from the one the browser would go on to build,
 * which is how a filter comes to agree with itself and not with reality.
 *
 * `DOMParser` is inert: no resource loads, no scripts, no timers. The dangerous document is
 * the one we then hand back a string for.
 *
 * Pure and dependency-free, like compare.js and dragdrop.js - no `import.meta.env` - so a
 * test can import it. It needs a DOM, which the test harness has.
 */

/** Elements drauu emits, and nothing else. `defs`/`marker`/`g` exist for arrowheads. */
const ELEMENTS = {
  path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap'],
  line: ['x1', 'y1', 'x2', 'y2', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'marker-end'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width',
    'stroke-dasharray', 'stroke-linecap'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap'],
  g: ['fill', 'stroke', 'stroke-width', 'marker-end'],
  defs: [],
  marker: ['id', 'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient'],
};

/* Only these may hold children, which is what stops a `<g>` nesting a thousand deep from
 * being a cheap way to make the parser somebody else's problem. */
const CONTAINERS = new Set(['g', 'defs', 'marker']);

/* The index drauu stamps on every committed node. Carried because `load()` restores an
 * op stack from it; nothing else here is a data attribute and nothing else may be. */
const INDEX = 'data-drauu_index';

/* A generated arrowhead id, and the `url(#...)` that points at one. Both are drauu's own
 * `guid()` output; anything else is refused rather than rewritten, because a reference this
 * does not recognise is a reference to something this file did not let through. */
const ID = /^[A-Za-z][\w-]{0,63}$/;
const REF = /^url\(#([A-Za-z][\w-]{0,63})\)$/;

/* Bounds, so a hostile payload costs a bounded amount rather than the tab. A stylus path is
 * genuinely long - perfect-freehand emits an outline with a point per few pixels - so the
 * per-value cap is generous and the real ceiling is the per-page one the transport applies. */
const MAX_NODES = 20000;
const MAX_DEPTH = 4;
const MAX_VALUE = 100000;

const esc = v => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * One element, rebuilt from the allowlist, or '' if it is not one of ours.
 *
 * Attribute names are matched case-INSENSITIVELY and then written in this file's own
 * spelling. SVG is case-sensitive about `viewBox` and `markerWidth`, so a filter that
 * compared exactly would let `VIEWBOX` through as unknown-and-dropped on one parser and
 * as-meant on another; normalising removes the question.
 */
function element(el, depth, budget) {
  const name = String(el.localName || '').toLowerCase();
  const allowed = Object.prototype.hasOwnProperty.call(ELEMENTS, name) ? ELEMENTS[name] : null;
  if (!allowed || budget.n++ >= MAX_NODES) return '';

  let out = `<${name}`;
  for (const canonical of allowed) {
    /* Read by the canonical name first - the HTML parser adjusts known SVG attributes back
     * to their real case - and fall back to a scan for anything it left lowercased. */
    let value = el.getAttribute(canonical);
    if (value == null) {
      const lower = canonical.toLowerCase();
      for (const a of el.attributes) {
        if (a.name.toLowerCase() === lower) { value = a.value; break; }
      }
    }
    if (value == null || value.length > MAX_VALUE) continue;
    if (canonical === 'id' && !ID.test(value)) continue;
    if (canonical === 'marker-end' && !REF.test(value)) continue;
    out += ` ${canonical}="${esc(value)}"`;
  }
  const index = el.getAttribute(INDEX);
  if (index != null && /^\d{1,9}$/.test(index)) out += ` ${INDEX}="${index}"`;

  if (!CONTAINERS.has(name) || depth >= MAX_DEPTH) return `${out} />`;
  return `${out}>${children(el, depth + 1, budget)}</${name}>`;
}

/* WALKED BY SIBLING, NOT BY `children`. An HTMLCollection is live, so reading it by index
 * re-derives it - O(n) an element and O(n squared) a page, which on a big drawing is not
 * slow but hung. It cost a test run to find and it would have cost a lesson. */
function children(parent, depth, budget) {
  let out = '';
  for (let el = parent.firstElementChild; el; el = el.nextElementSibling) {
    out += element(el, depth, budget);
  }
  return out;
}

/**
 * A drawing, reduced to the parts of it that are drawings.
 *
 * Takes and returns the SVG element's inner markup - the shape `drauu.dump()` produces and
 * `drauu.load()` accepts - so it drops into either end without either knowing it is there.
 * Returns '' for anything unparseable, which loads as an empty page: a drawing that will not
 * filter is not a smaller drawing, it is a message we do not understand.
 */
export function clean(svg) {
  const text = typeof svg === 'string' ? svg : '';
  if (!text.trim()) return '';
  try {
    const doc = new DOMParser()
      .parseFromString(`<!DOCTYPE html><body><svg>${text}</svg>`, 'text/html');
    const root = doc.body?.querySelector('svg');
    if (!root) return '';
    return children(root, 0, { n: 0 });
  } catch {
    return '';
  }
}
