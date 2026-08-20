/* Make an embedded app's frame fit the app inside it.
 *
 * `::app <name> height=NNN::` authored the height by hand, which meant guessing, and the
 * failure was silent: an app that crops loses the chart the question asks about and the
 * exercise still looks fine. The authored number becomes a FLOOR here - the frame is never
 * shorter than it, and grows if the app's content genuinely needs more.
 *
 * WHY NOT postMessage. The frame is same-origin and has to be (see md.js: without
 * `allow-same-origin` a module script inside the bundle can never load at all), so the
 * parent can read `contentDocument` directly. No change to the twenty-two bundles, and no
 * cooperation required from bundles nobody here wrote.
 *
 * WHY MEASURING IS NOT OBVIOUS. Sixteen of the twenty-two set `min-height: 100vh` on their
 * root - they were built to fill DataCamp's exercise pane. Inside an iframe `100vh` is the
 * frame's own height, so measuring at the height you just set is circular: the app reports
 * at least what you gave it, you give it that plus the body margin, it reports that, and
 * the frame walks down the page a few pixels at a time.
 *
 * Neutralising the 100vh would break those apps rather than fix them - if the chart is
 * `flex: 1`, removing the floor collapses the chart instead of fitting it, and a collapsed
 * chart is worse than empty space.
 *
 * So every measurement is taken at the SAME reference height, the floor. `fit()` sets the
 * frame to the floor, reads, and writes the answer back within one task, so the reference
 * height is never painted. That makes the measurement a function of the app's content
 * alone rather than of its own previous output, which is what stops the walk: an app that
 * fills the viewport reports the floor and stays at the floor, and an app that sizes to its
 * content reports that size however tall the frame currently is.
 */

/* Only reached by an `::app` line with no `height=`; all twenty-two written so far set one.
 * Small on purpose - it is a floor, and the measurement is expected to do the work. */
export const DEFAULT_FLOOR = 360;

const wired = new WeakSet();

/**
 * Size one frame to its app. Returns true if the height changed.
 *
 * Throws nothing: a frame that cannot be read keeps the height the author gave it, which is
 * exactly the behaviour this replaced.
 */
function fit(frame, iframe) {
  const doc = iframe.contentDocument;
  if (!doc || !doc.documentElement) return false;
  const floor = Number(frame.dataset.floor) || DEFAULT_FLOOR;
  const before = frame.style.height;
  /* Set, read, set - all synchronous, so the browser lays out twice and paints once. The
   * middle value existing on screen for a frame is the difference between this and a
   * visible flicker on every slider drag. */
  frame.style.height = `${floor}px`;
  const measured = doc.documentElement.scrollHeight;
  frame.style.height = `${Math.max(floor, measured)}px`;
  return frame.style.height !== before;
}

function wire(frame, iframe) {
  if (wired.has(iframe)) return;
  wired.add(iframe);

  /* Our own write resizes the app, which fires its ResizeObserver, which would call us
   * again. `fit` is deterministic - same content, same reference height, same answer - so
   * the second pass agrees and writes nothing, and the loop ends there. This just stops the
   * pointless round trip. Two frames because a ResizeObserver callback is delivered before
   * the paint AFTER the layout that triggered it. */
  let busy = false;
  const refit = () => {
    if (busy) return;
    try { fit(frame, iframe); } catch { return; }   // cross-origin: keep the authored height
    busy = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { busy = false; }));
  };

  const start = () => {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc?.documentElement) return;
    refit();
    /* Several of these redraw on a slider or a tab click, so one measurement on load is not
     * enough. The observer comes from the frame's own realm: it is watching an element in
     * that document, and its lifetime should end with it. */
    const Observer = win.ResizeObserver || window.ResizeObserver;
    if (Observer) new Observer(refit).observe(doc.documentElement);
  };

  iframe.addEventListener('load', start);
  // `loading="lazy"` means the frame may already be there and done by the time this runs.
  if (iframe.contentDocument?.readyState === 'complete') start();
}

/**
 * Watch for embedded app frames anywhere under `root` and size them as they appear.
 *
 * INSTALLED ONCE, GLOBALLY, rather than owned by a component. The `::app` markup is
 * produced by `md.js` and injected with `v-html` from four different components - the
 * prompt, the instructions, an MCQ option, a hint - and any future one that renders prose
 * would silently get fixed-height frames again. There is no component that owns an app
 * frame, so there is nowhere for this to live except here.
 */
export function watchAppFrames(root = document.body) {
  const scan = () => {
    for (const iframe of root.querySelectorAll('.appframe > iframe'))
      wire(iframe.parentElement, iframe);
  };
  scan();
  // childList only: the height we write is an attribute change, and observing those would
  // hand us back our own writes forever.
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
}
