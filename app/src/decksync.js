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
 *
 * AND NOTHING ELSE. The click step was carried here too, and it never once worked - which is
 * worth writing down, because the reason is structural rather than a bug to go and fix.
 *
 * Slidev only ever WRITES `clicks` into its shared channel from `setup/root.ts`:
 *
 *     if (!isPresenter.value && !TRUST_ORIGINS.includes(location.host.split(':')[0])) return
 *
 * TRUST_ORIGINS is `['localhost', '127.0.0.1']`. Our decks are viewers on icecampus.com, so
 * that returns on every navigation and the channel never changes: there is nothing to relay
 * and never was. Confirmed on the wire - a whole lesson of `deck` frames, not one of them
 * `- shared`.
 *
 * Relaying it was also actively unsafe in the one case it could have fired. The receiving
 * side applies a shared patch through Slidev's own `onPatch`, which does
 * `router.replace(getSlidePath(state.page))` - and `page` is the one field we must never
 * carry, so it would still be the default 1. A student would be sent to the first slide of
 * the deck by a patch about clicks. Worse, `router.replace` moves the deck through
 * `history.replaceState`, which fires no event at all: the clamp in `SlidesStep` would not
 * see it and the frame would not report it. Silent, and blamed on anything but this.
 *
 * `page` cannot travel because where the class is looking already has one authority - the
 * room reports the educator's position, the walk resolves it to a row, and `SlidesStep`
 * drives the frame and clamps it to the topic. So the click step cannot travel either, and
 * the honest thing is to stop pretending it does. Doing it properly means teaching the theme
 * to substitute the deck's OWN current page into an incoming shared patch, which is a change
 * in `slidev-theme-ice` and a rebuild of every deck.
 *
 * The timer and snapshots were dropped for a duller reason: nothing shows them.
 *
 * WHO A PATCH IS FOR IS THE TAB'S OWN QUESTION, and there are two answers.
 *
 * The tab delivering the lesson draws for the ROOM - same authority as the position, so a
 * class cannot follow one screen's slide and another screen's annotations. A control tab
 * draws for the ONE STUDENT whose screen it holds, which is the whole point of annotating
 * while you help somebody. This started as leader-only and that was wrong in the most
 * obvious case: drawing on a slide to explain it to the person you are helping.
 *
 * The two tabs are the same PERSON, so the server cannot tell them apart - `by` is a sub and
 * both connections carry it. The tab says which it is and the Lambda checks it is entitled to
 * say so: `room` needs the session, `driven` needs the control.
 */
import { clean } from './svgclean.js';

const MESSAGE = 'ice:deck-sync';
/* WELL UNDER A WEBSOCKET FRAME, per message.
 *
 * Slidev hands over the WHOLE channel every time any part of it changes, so a `drawings`
 * patch is every annotated slide in the deck - and each of those is an SVG path with a point
 * per pixel of the stroke. A lesson's worth is not a few kilobytes. API Gateway's frame
 * limit is far below what that reaches, and a frame over it is not truncated or rejected in
 * a way anybody could see: the connection is closed. Which reads as the room going quiet
 * rather than as a message being too big.
 *
 * So this is a ceiling per SLIDE, and only what has actually changed is sent - see `changed`.
 * A slide whose drawing is somehow bigger than this is dropped and said so out loud, because
 * half an SVG is not a smaller drawing, it is a parse error blamed on the wrong thing. */
const CAP = 24 * 1024;
/* Coalesced. Slidev watches its state deeply, so a stroke is many changes; ten a second is
 * far more than an annotation needs and is a tenth of what the pointer already costs. */
const EVERY = 100;
/* AND A LAST ONE ONCE THE HAND STOPS.
 *
 * Everything above is a diff, so a frame that never arrives is not caught up by the next
 * one - the sender has already recorded that key as sent and will not offer it again until
 * it changes. Two things drop frames: a socket that is between connections (`send` returns
 * false and says nothing), and the ordering below, which discards a patch that lost its
 * race. Both leave the room holding a stroke that is one move short of what was drawn.
 *
 * So after the drawing settles, whatever this tab currently believes the room has is sent
 * once more in full. It is the same bytes the room should already be holding, applied
 * last-write-wins over the top, and it costs one message per stroke rather than per frame.
 * Long enough not to fire mid-stroke; short enough that a missing tail is a blink. */
const SETTLE = 600;

/* WHICH TAB, AND HOW FAR ALONG. See the `deck` case in the live Lambda: API Gateway runs
 * every frame as its own concurrent invocation and imposes no order on them, so the wire
 * cannot be trusted to deliver a stroke in the order it was drawn. The counter is per tab
 * because an educator's room tab and their control tab are two senders that know nothing of
 * each other, and `origin` is random rather than derived from the sub for the same reason -
 * plus it then says nothing about anybody. */
const ORIGIN = Math.random().toString(36).slice(2, 12);
let seq = 0;

/* KEYED BY WHAT A CHANNEL IS, NOT BY WHAT IT IS CALLED.
 *
 * Slidev names its channels after the deck - `setup/root.ts` does
 *
 *     initSharedState(`${slidesTitle} - shared`)
 *     initDrawingState(`${slidesTitle} - drawings`)
 *
 * so the key that actually arrives is the whole title with a suffix on it:
 * "Python for ONEY - 1.1 Using NumPy... - Slidev - drawings". Matching `drawings` exactly
 * meant nothing was ever carried and annotations silently went nowhere - the relay ran, the
 * theme posted, and every patch was dropped one line into this file.
 *
 * The suffix is the kind and the rest is which deck. Both matter: the title being in the key
 * is what stops a patch for one unit's deck being applied to another's, because the theme
 * compares the name against its own and ignores a mismatch. So the name travels WHOLE and
 * only the suffix is interpreted. */
const KEEP = {
  drawings: null,                        // null means the whole channel
};
const kindOf = channel => (typeof channel === 'string'
  ? Object.keys(KEEP).find(k => channel.endsWith(` - ${k}`)) || null
  : null);

/**
 * Only the fields worth sending, or null when the channel is not one we carry.
 *
 * Exported because it IS the policy - `page` never travelling is the rule this file exists
 * to state - and because a rule nothing can test is a rule that quietly stops being true.
 */
export function carried(channel, data) {
  const kind = kindOf(channel);
  if (!kind || !data || typeof data !== 'object') return null;
  const keys = KEEP[kind];
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
let settle = null;       // the trailing resend, armed on every flush
let audience = () => null;   // 'room' | 'driven' | null when this tab relays nothing
let out = () => {};
/* What the room has already been told, per channel, so that only differences travel.
 *
 * THIS IS NOT AN OPTIMISATION. Slidev replaces the whole channel on every change, so
 * without it every stroke re-sends every annotated slide in the deck - a message that grows
 * for the length of a lesson and takes the socket with it when it passes the frame limit.
 * Diffing keeps a message the size of the stroke somebody just drew.
 *
 * Partial patches are what the other side wants anyway: Slidev's own `onUpdate` assigns the
 * keys it is given and leaves the rest alone, so a patch of one slide is applied as one
 * slide rather than as a deck with one slide in it. */
let sent = {};

/** The keys of `data` that differ from what has already gone out on this channel. */
function changed(channel, data) {
  const was = sent[channel] || {};
  const now = {};
  let any = false;
  for (const [k, v] of Object.entries(data)) {
    const body = JSON.stringify(v);
    if (was[k] === body) continue;
    if (body.length > CAP) {
      console.warn('decksync: dropping', channel, k, `- ${body.length} bytes is over the cap`);
      continue;
    }
    now[k] = body;
    any = true;
  }
  /* A key that has GONE - an annotation cleared off a slide - is a change too, and the
   * undoing of one is exactly as worth sending as the drawing of it. */
  for (const k of Object.keys(was)) {
    if (!(k in data)) { now[k] = undefined; any = true; }
  }
  return any ? now : null;
}

/**
 * Put one patch on the wire, stamped so the far side can tell what is behind.
 *
 * ITS ANSWER IS BELIEVED. `send` in live.js drops silently when there is no socket, which is
 * the right behaviour for a channel and the wrong thing to ignore here: recording a key as
 * sent when it was not means the diff will never offer it again, so a stroke drawn during a
 * reconnection is lost for the rest of the lesson rather than for a second. The resend below
 * is the other half of that, for the frames nothing local can know were lost.
 */
function put(channel, patch) {
  return out(channel, patch, audience(), { origin: ORIGIN, seq: ++seq }) !== false;
}

function flush() {
  timer = null;
  if (!pending) return;
  const batch = pending;
  pending = null;
  for (const [channel, data] of Object.entries(batch)) {
    const diff = changed(channel, data);
    if (!diff) continue;
    const patch = {};
    const next = { ...(sent[channel] || {}) };
    for (const [k, body] of Object.entries(diff)) {
      if (body === undefined) { patch[k] = null; delete next[k]; }
      else { patch[k] = JSON.parse(body); next[k] = body; }
    }
    // Only once it has actually gone - see `put`. Otherwise the next diff skips it forever.
    if (put(channel, patch)) sent[channel] = next;
  }
  clearTimeout(settle);
  settle = setTimeout(resend, SETTLE);
}

/**
 * Once the hand stops: say again, in full, what the room should be holding.
 *
 * Not a diff and not conditional on anything having changed - the whole point is the case
 * where this tab believes a key arrived and it did not. The far side applies it
 * last-write-wins over identical bytes, so the ordinary outcome is that nothing happens.
 *
 * Bounded by the number of ANNOTATED SLIDES in the deck rather than by the length of the
 * lesson, and only after drawing has settled, so it is one message per stroke.
 */
function resend() {
  settle = null;
  for (const [channel, keys] of Object.entries(sent)) {
    const patch = {};
    for (const [k, body] of Object.entries(keys)) patch[k] = JSON.parse(body);
    if (Object.keys(patch).length) put(channel, patch);
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
  const to = audience();
  if (!to) return;
  const keep = carried(m.channel, m.data);
  if (!keep) return;
  pending = { ...(pending || {}), [m.channel]: keep };
  if (!timer) timer = setTimeout(flush, EVERY);
}

/**
 * Start relaying, given a way to ask who this tab's patches are for.
 *
 * A callback rather than a value for `reportActivity`'s reason: this module has no business
 * watching the session's state, and the caller already knows which kind of tab it is. `send` arrives the same way and
 * for a second reason: importing it would pull in `delivery.js`, and with it `auth.js` and an
 * `import.meta.env` Node cannot evaluate - which would put the policy above out of reach of
 * any test that did not build the whole player.
 *
 * So this file imports NOTHING BUT `svgclean.js`, which is of the same kind as this one -
 * pure, dependency-free, no `import.meta.env` - and so costs the property nothing.
 */
export function watchDecks(whoFor, send) {
  audience = whoFor;
  out = send;
  addEventListener('message', fromDeck);
  return () => {
    removeEventListener('message', fromDeck);
    clearTimeout(timer);
    clearTimeout(settle);
    timer = null;
    settle = null;
    pending = null;
    sent = {};
    seen = {};
    audience = () => null;
    out = () => {};
  };
}

/* A DRAWING OFF THE SOCKET IS FILTERED BEFORE IT CROSSES INTO THE DECK.
 *
 * Slidev applies each value with drauu's `load()`, which is `innerHTML`, so a patch is
 * markup from another browser being built into the DOM of a same-origin frame. See
 * svgclean.js for what that reaches. The boundary is here rather than inside the deck
 * because this is the last place the payload is ours: past `postMessage` it is Slidev's.
 *
 * ONLY INCOMING. What the educator drew is their own DOM and filtering it on the way out
 * would be filtering ourselves - and would hide, rather than fix, a drawing this cannot
 * represent.
 *
 * The values are drauu dumps: `useDrawings.ts` stores `drauu.dump()` per slide number. A
 * value that will not filter arrives as an empty slide, which is the honest rendering of a
 * message we do not understand.
 */
function filtered(channel, data) {
  if (kindOf(channel) !== 'drawings') return data;
  const out = {};
  for (const [slide, svg] of Object.entries(data)) {
    out[slide] = typeof svg === 'string' ? clean(svg) : svg;
  }
  return out;
}

/* The highest sequence heard from each sending tab, per channel.
 *
 * `origin` is in the key because two tabs count independently and neither knows about the
 * other: an educator's room tab and their control tab are two senders, and a student being
 * helped hears both. Merged into one counter they would each read as stale to the other and
 * one of the two would stop drawing entirely. */
let seen = {};

/**
 * Whether this patch is newer than the last one heard from the same tab on the same channel.
 *
 * A DECK PATCH IS LAST-WRITE-WINS WHOLE-SLIDE SVG, and the frames arrive out of order: each
 * one is its own concurrent Lambda invocation and API Gateway orders nothing. So a stroke's
 * final frame can land before an earlier one and be overwritten by it - which is the whole
 * of "I drew a square and only three sides appeared". Nothing on the wire can be ordered, so
 * the sender counts and this drops what is behind.
 *
 * Unstamped patches pass. An older deployment sends none, and a deck patch arriving without
 * one is worth applying out of order far more than it is worth discarding.
 */
function fresh(channel, origin, n) {
  if (!origin || typeof n !== 'number') return true;
  const key = `${origin}\u0000${channel}`;
  if (seen[key] !== undefined && n <= seen[key]) return false;
  seen[key] = n;
  return true;
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
export function applyDeck(channel, data, { origin, seq: n } = {}) {
  if (!fresh(channel, origin, n)) return;
  const keep = carried(channel, data);
  if (keep) intoDecks(channel, filtered(channel, keep));
}
