/* WHERE THE EDUCATOR IS POINTING, on the screen they are driving.
 *
 * The caret says where they are in the code. This says where they are on the SCREEN - the
 * result grid, a figure in the prompt, a region of a slide - which is everything the caret
 * cannot reach and most of what somebody points at while explaining something.
 *
 * RELATIVE TO A REGION, NEVER TO THE VIEWPORT, and that is the whole design.
 *
 * The obvious thing is to send `x / innerWidth` and multiply back on the other side. It does
 * not work here and it fails in the way that is hardest to notice. The shell is FIXED pixels
 * either side of a fluid middle:
 *
 *     .shell        272px  minmax(0, 1fr)  336px
 *     .shell.railed  44px  minmax(0, 1fr)  336px
 *
 * so the sidebar is a fifth of a 1280 screen and a tenth of a 2560 one. Scaled viewport to
 * viewport, a pointer sitting in the educator's editor arrives inside the student's sidebar -
 * and wrongly by less the further right it goes, so it looks approximately right everywhere
 * and is correct nowhere. An aspect-ratio correction does not help: the error is not the
 * shape of the screen, it is that the layout does not scale with it.
 *
 * So a point is `{ region, x, y }` where the fractions are of that REGION's box. The two
 * screens have to agree that a thing called `result` exists. They do not have to agree on
 * where it is, how big it is, what shape it is, or which panels are open - which is why a
 * student who has collapsed something the educator has open needs no reconciling: the region
 * is not there, and this declines to draw rather than guessing.
 *
 * A region is marked with `data-point="<name>"` in the template, and the innermost one under
 * the pointer wins. `stage` wraps the lot, so the dot degrades to roughly-right rather than
 * disappearing when somebody points at the space between two panes.
 *
 * NOT INSIDE THE EDITOR'S TEXT. The editor is a region, but the accurate answer in there is
 * the caret and the selection, which are document offsets and map exactly through a
 * different scroll position. The dot is there so the pointer does not vanish mid-gesture,
 * not to name a character.
 *
 * Pure and dependency-free, like compare.js and walk.js - no `import.meta.env` - so the
 * builder and a test can import it.
 */

/** The innermost marked region containing a point, with its box. */
export function regionAt(x, y, doc = document) {
  const el = doc.elementFromPoint(x, y);
  const region = el?.closest?.('[data-point]');
  if (!region) return null;
  const box = region.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return { name: region.dataset.point, box };
}

/** Clamped, because a pointer on the border of a region rounds to just outside it. */
const unit = v => Math.min(1, Math.max(0, v));

/**
 * A pointer position as something the other screen can use, or null when it is over nothing
 * anybody has named.
 */
export function pointFrom(x, y, doc = document) {
  const hit = regionAt(x, y, doc);
  if (!hit) return null;
  return {
    region: hit.name,
    x: Math.round(unit((x - hit.box.left) / hit.box.width) * 1e4) / 1e4,
    y: Math.round(unit((y - hit.box.top) / hit.box.height) * 1e4) / 1e4,
  };
}

/* THE SLIDE INSIDE THE FRAME, in the coordinates of the page around it.
 *
 * A deck is its own document in an iframe, so it is the one region whose box cannot be read
 * with a selector on this page - and it is also the region where a fraction is EXACT rather
 * than approximate, because a slide is a fixed 16:9 stage. Worth the special case for that
 * alone: pointing at a diagram is most of why anybody wants a pointer at all.
 *
 * The frame's own coordinates start at its content box, so the two rectangles simply add.
 * Cross-origin would throw on `contentDocument`; these are same-origin by construction, and
 * the try is for a frame that has not finished loading rather than for a foreign one.
 */
const SLIDE = '.slidev-slide-content';
export function slideBox(doc = document) {
  const frame = doc.querySelector('iframe[data-point-frame]');
  if (!frame) return null;
  let inner = null;
  try { inner = frame.contentDocument?.querySelector(SLIDE); } catch { return null; }
  if (!inner) return null;
  const f = frame.getBoundingClientRect();
  const b = inner.getBoundingClientRect();
  if (!b.width || !b.height) return null;
  return { left: f.left + b.left, top: f.top + b.top, width: b.width, height: b.height };
}

/**
 * And back again: where on THIS screen a received point falls, in viewport pixels.
 *
 * Null when the region is not on screen - a panel the student has closed, a pane that only
 * exists on one kind of exercise. Drawing nothing is the honest answer, and it is available
 * only because the point named a region rather than a fraction of a window.
 */
/* A REGION NAME IS ONE OF OURS, and it arrives off a socket, so it is checked rather than
 * escaped. `CSS.escape` would do the job in a browser and does not exist in Node - and this
 * file has to stay importable outside one, like compare.js and walk.js. Validating is the
 * better answer anyway: the set of names is closed and short, and anything else is a message
 * this version does not understand rather than something to render carefully. */
const NAME = /^[a-z][a-z0-9-]{0,30}$/;

export function placeAt(point, doc = document) {
  if (!point?.region || !NAME.test(point.region)) return null;
  const box = point.region === 'slides'
    ? slideBox(doc)
    : doc.querySelector(`[data-point="${point.region}"]`)?.getBoundingClientRect();
  if (!box?.width || !box?.height) return null;
  return {
    left: box.left + unit(point.x) * box.width,
    top: box.top + unit(point.y) * box.height,
  };
}

/**
 * WATCH A POINTER AND REPORT IT, throttled, until the returned function is called.
 *
 * FIFTEEN A SECOND. A pointer is the first thing on this channel that is continuous rather
 * than discrete, so it is the first that needs a rate rather than a debounce: a debounce
 * would report where the mouse STOPPED, which is exactly the frames a gesture is not made of.
 * Fifteen reads as motion and is a fifth of what the display could carry.
 *
 * LEAVING IS SENT, NOT INFERRED. Silence is also what a dropped frame looks like, so a dot
 * that lingers wherever the last packet landed is worse than no dot at all - it points at
 * something nobody is pointing at, which is the one failure this feature cannot afford.
 *
 * `send` is given the point or null for "gone", and is expected to drop it if there is
 * nowhere to send it - which is what the channel does anyway.
 */
export function watchPointer(send, { fps = 15, doc = document, win = window } = {}) {
  const every = 1000 / fps;
  let last = 0;
  let pending = null;
  let timer = null;
  let gone = true;

  const flush = () => {
    timer = null;
    if (!pending) return;
    last = Date.now();
    const p = pending;
    pending = null;
    gone = false;
    send(p);
  };

  /** A point, or null for "the pointer has gone". Throttled; a leave is never held back. */
  const report = p => {
    if (!p) {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      if (gone) return;
      gone = true;
      send(null);
      return;
    }
    pending = p;
    const wait = every - (Date.now() - last);
    /* The trailing edge matters more than the leading one here: a gesture ends on a position
     * somebody chose, and dropping the last frame of it leaves the dot short of the thing
     * being pointed at. */
    if (wait <= 0) flush();
    else if (!timer) timer = setTimeout(flush, wait);
  };

  const onMove = e => report(pointFrom(e.clientX, e.clientY, doc));
  const leave = () => report(null);

  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerleave', leave);
  win.addEventListener('blur', leave);
  /* THE DECKS PUSH IN THROUGH HERE. A slide is its own document in an iframe, so no listener
   * on this page ever sees a pointer move over it - the frame has to report for itself. It
   * cannot be told when to start, though: the frames come and go as a student walks through a
   * course, and they know nothing about who is driving whom. So they report unconditionally
   * into a sink that only exists while somebody is driving, and say nothing the rest of the
   * time because there is nobody to say it to. */
  sink = report;
  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerleave', leave);
    win.removeEventListener('blur', leave);
    report(null);
    if (sink === report) sink = null;
  };
}

/* Where a frame's own pointer moves go, while somebody is driving. Null the rest of the time,
 * which is what makes `watchFrame` free to be installed on every deck the player ever shows. */
let sink = null;

/**
 * REPORT A POINTER MOVING OVER A SLIDE, from inside the deck's own document.
 *
 * Against the SLIDE's box rather than the frame's, and that is the point of doing it here at
 * all: a deck letterboxes itself to 16:9 inside whatever pane it is given, so the frame is a
 * different shape on the two screens and the slide is not. A fraction of the slide is the one
 * measurement in this whole feature that is exact.
 *
 * Returns a function that stops it - though in practice the browser does that for us, because
 * these listeners live on the frame's own window and the frame is rebuilt whenever the deck or
 * the topic changes.
 */
export function watchFrame(win, doc) {
  const onMove = e => {
    if (!sink) return;
    const slide = doc.querySelector(SLIDE);
    if (!slide) return;
    const b = slide.getBoundingClientRect();
    if (!b.width || !b.height) return;
    sink({
      region: 'slides',
      x: Math.round(unit((e.clientX - b.left) / b.width) * 1e4) / 1e4,
      y: Math.round(unit((e.clientY - b.top) / b.height) * 1e4) / 1e4,
    });
  };
  const leave = () => sink?.(null);
  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerleave', leave);
  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerleave', leave);
  };
}
