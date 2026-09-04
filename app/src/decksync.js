/* THE EDUCATOR'S DECK, ON THE CLASS'S SCREENS - annotations and click steps.
 *
 * Slidev already syncs a deck's shared state between a presenter and its viewers. What it
 * cannot do is carry it to anybody else: `__SLIDEV_HAS_SERVER__` is false in a build, so its
 * transport falls back to a `BroadcastChannel` that reaches other tabs of the same browser
 * and nothing further. Every deck we publish is a build. So an educator drawing on a slide
 * was drawing for an audience of one, and a `v-click` build was revealed to nobody.
 *
 * `slidev-theme-ice` registers a sync method that posts each channel's state to the page
 * around the deck and applies whatever that page sends back. THIS is that page. The theme is
 * a pipe with no opinions - it does not know who is teaching, whether a lesson is running, or
 * which parts of a channel matter. All of that is here, because all of it is ours.
 *
 * WHAT IS RELAYED, AND WHAT IS DELIBERATELY NOT:
 *
 *   drawings   in full. This is the feature: what the educator drew, per slide.
 *   shared     `clicks` and `clicksTotal` ONLY.
 *
 * `page` IS DROPPED, and that is the important line in this file. Where the class is looking
 * is already answered - the room reports the educator's position, the walk resolves it to a
 * row, and `SlidesStep` drives the frame's hash and clamps it to the topic. Letting Slidev's
 * own `page` through would be a SECOND authority for one fact, and the two would not merely
 * duplicate: our clamp walls a student inside their topic's range, so a synced page pointing
 * past it would be pushed back, re-sent, and pushed back again. One authority for where we
 * are; Slidev adds only the step within the slide it is already on.
 *
 * The timer and snapshots are dropped for a duller reason: nothing shows them.
 *
 * ONE LEADER, AND IT IS THE TAB DELIVERING THE LESSON. Same authority as the position, so a
 * class cannot be following one screen's slide and another screen's annotations. A control
 * tab is explicitly not it - it holds one student's screen, and its drawings belong to that
 * student rather than to the room.
 */
const MESSAGE = 'ice:deck-sync';
/* A drawing is an SVG per slide and arrives as a whole channel. Dropped rather than
 * truncated past the cap, because half an SVG is not a smaller drawing - it is a parse
 * error, and one that would be blamed on the annotation feature rather than on a limit. */
const CAP = 96 * 1024;
/* Coalesced. Slidev watches its state deeply, so a stroke is many changes; ten a second is
 * far more than an annotation needs and is a tenth of what the pointer already costs. */
const EVERY = 100;

const KEEP = {
  drawings: null,                        // null means the whole channel
  shared: ['clicks', 'clicksTotal'],
};

/**
 * Only the fields worth sending, or null when the channel is not one we carry.
 *
 * Exported because it IS the policy - `page` never travelling is the rule this file exists
 * to state - and because a rule nothing can test is a rule that quietly stops being true.
 */
export function carried(channel, data) {
  if (!(channel in KEEP) || !data || typeof data !== 'object') return null;
  const keys = KEEP[channel];
  if (!keys) return data;
  const out = {};
  for (const k of keys) if (data[k] !== undefined) out[k] = data[k];
  return Object.keys(out).length ? out : null;
}

/** Every deck on screen. There is at most one, but a stale frame mid-swap is not an error. */
const frames = () => document.querySelectorAll('iframe[data-deck]');

/** Apply a patch to whatever deck is showing. Same-origin by construction. */
function intoDecks(channel, data) {
  for (const f of frames()) {
    try { f.contentWindow?.postMessage({ kind: MESSAGE, channel, data }, location.origin); }
    catch { /* a frame mid-navigation has no window to talk to */ }
  }
}

let pending = null;      // channel -> the latest state seen
let timer = null;
let leading = () => false;
let out = () => {};

function flush() {
  timer = null;
  if (!pending) return;
  const batch = pending;
  pending = null;
  for (const [channel, data] of Object.entries(batch)) {
    const body = JSON.stringify(data);
    if (body.length > CAP) continue;
    out(channel, data);
  }
}

function fromDeck(e) {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (m?.kind !== MESSAGE || typeof m.channel !== 'string') return;
  /* `data: null` is the theme announcing that a deck is listening on a channel, not a state
   * to pass on. Nothing has to be done with it - the reply is whatever arrives next from the
   * room - but it must not be relayed as though it were a patch. */
  if (!m.data) return;
  if (!leading()) return;
  const keep = carried(m.channel, m.data);
  if (!keep) return;
  pending = { ...(pending || {}), [m.channel]: keep };
  if (!timer) timer = setTimeout(flush, EVERY);
}

/**
 * Start relaying, given a way to ask whether this tab is the one leading.
 *
 * A callback rather than a value for `reportActivity`'s reason: this module has no business
 * watching the session's state, and the caller already knows. `send` arrives the same way and
 * for a second reason: importing it would pull in `delivery.js`, and with it `auth.js` and an
 * `import.meta.env` Node cannot evaluate - which would put the policy above out of reach of
 * any test that did not build the whole player. This file imports NOTHING.
 */
export function watchDecks(amLeading, send) {
  leading = amLeading;
  out = send;
  addEventListener('message', fromDeck);
  return () => {
    removeEventListener('message', fromDeck);
    clearTimeout(timer);
    timer = null;
    pending = null;
    leading = () => false;
    out = () => {};
  };
}

/**
 * A patch off the channel, on its way into the deck.
 *
 * WHO MAY BE SENT ONE IS THE CALLER'S QUESTION, not this file's - which is also what keeps
 * the two modules out of a cycle. delivery.js holds the session and knows whether this client
 * is the one leading; here there is only a deck and a patch.
 *
 * Applied whether or not this client is following, deliberately: annotations are drawn ON a
 * slide and are part of it while they are there. A student who has wandered a page ahead and
 * comes back should find what was drawn while they were gone, not a blank slide - the state
 * is keyed by slide number and Slidev renders whichever one is showing.
 */
export function applyDeck(channel, data) {
  const keep = carried(channel, data);
  if (keep) intoDecks(channel, keep);
}
