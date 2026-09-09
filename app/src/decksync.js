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
/* A CEILING ON THE MESSAGE, and it is a backstop rather than a working limit.
 *
 * This was 24KB applied to each SLIDE's whole drawing, and it wedged a lesson. Slidev hands
 * over the entire channel on every change and drauu's dump of a slide is every stroke ever
 * made on it, so the thing being measured only ever grew - and `changed` skipped an oversized
 * key on every frame from then on, forever, because the next frame was bigger still. The room
 * froze mid-word and no later stroke on that slide ever appeared again.
 *
 * Cursive is what found it, and the arithmetic says why: `toSvgData` emits a cubic per point,
 * `C 123.45,678.90 123.45,678.90 123.45,678.90`, about 45 characters. A word written in one
 * stroke is a couple of hundred points after simplification - ten kilobytes for "hello" -
 * where a dozen short strokes are a few hundred bytes each. So short strokes worked and
 * handwriting did not, which is not a size anybody would have guessed at.
 *
 * What actually fixed it is that a message is now a DELTA - see `chunked` - so what travels is
 * the stroke being drawn rather than the history of the slide. This number is what is left
 * over: a single stroke larger than it is a real limit rather than an accumulation, and API
 * Gateway closes a connection carrying a frame over its own limit without saying so, which
 * reads as the room going quiet rather than as a message being too big. */
const CAP = 96 * 1024;
/* Coalesced. Slidev watches its state deeply, so a stroke is many changes; ten a second is
 * far more than an annotation needs and is a tenth of what the pointer already costs. */
const EVERY = 100;
/* AND A WHOLE ONE ONCE THE HAND STOPS.
 *
 * A delta can only be applied by somebody holding what it was computed against, and three
 * things leave a client without that: a socket between connections (`send` drops silently), a
 * patch discarded as stale by the ordering below, and joining the room after the drawing was
 * made. A student in any of those states declines the delta - it says `keep: 4` and they have
 * two - and would otherwise stay a stroke short for the rest of the lesson.
 *
 * So once drawing settles, the whole state goes out as a snapshot: `full`, applicable by
 * anybody whatever they are holding. That is what makes the delta safe rather than clever -
 * every gap is closed within a breath of the hand stopping, and it costs one message per
 * stroke rather than per frame.
 *
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
/**
 * One slide's drawing, split into the pieces a diff can be taken against.
 *
 * NOT A PARSE, and deliberately not: this splits before every opening tag and nothing else,
 * so joining the pieces back reproduces the input byte for byte whatever the markup was. A
 * closing tag begins `</`, which is not a letter, so it stays attached to the piece it closes
 * and a `<g>` holding an arrowhead simply splits into more pieces than it has elements. That
 * costs a slightly coarser diff and cannot be wrong, where a real parse would have to agree
 * with drauu about nesting - and svgclean.js already exists because trusting markup from
 * another browser is the thing not to do. Nothing here interprets it; it is cut and rejoined.
 *
 * drauu appends: a finished stroke never changes again, and the one being drawn is always
 * last. So a common prefix is nearly always everything but the stroke in progress, which is
 * exactly the message this file wants to send.
 */
const chunked = svg => (typeof svg === 'string' && svg ? svg.split(/(?=<[a-zA-Z])/) : []);

/* What the room is holding, per channel and slide, as those pieces.
 *
 * THIS IS THE WHOLE OF WHY A LESSON'S ANNOTATION FITS. Slidev replaces the whole channel on
 * every change and a slide's dump is every stroke ever made on it, so without this each frame
 * carries the history again - a message that grows all lesson and, at ten frames a second,
 * grew until it passed the cap and the slide stopped updating for good. Against this, a frame
 * is the stroke somebody is drawing.
 *
 * Partial patches are what the other side wants anyway: Slidev's own `onUpdate` assigns the
 * keys it is given and leaves the rest alone, so a patch of one slide is applied as one slide
 * rather than as a deck with one slide in it. */
let sent = {};

/**
 * What to send for each slide that has moved, against what the room is holding.
 *
 * `{ keep, add }` is "the first `keep` pieces you have are still right, then these" - a
 * truncate and an append, which covers drawing (keep everything, add the new stroke), undo
 * and erase (keep fewer, add what follows) and clearing (keep nothing). `full` marks a
 * snapshot, which needs nothing to be already held and is how a gap is closed - see SETTLE.
 *
 * Returns the patch and the state it would leave, rather than committing to it: whether it
 * actually goes is `send`'s answer, and recording it regardless is how a stroke drawn during
 * a reconnection is lost for the rest of the lesson.
 */
function delta(channel, data) {
  const was = sent[channel] || {};
  const patch = {};
  const next = {};
  let any = false;
  for (const [k, v] of Object.entries(data)) {
    const now = chunked(v);
    next[k] = now;
    const before = was[k] || [];
    let i = 0;
    while (i < before.length && i < now.length && before[i] === now[i]) i += 1;
    if (i === before.length && i === now.length) continue;
    patch[k] = { keep: i, add: now.slice(i) };
    any = true;
  }
  /* A key that has GONE - an annotation cleared off a slide - is a change too, and the
   * undoing of one is exactly as worth sending as the drawing of it.
   *
   * As an empty SNAPSHOT rather than a null. Slidev's `onPatchDrawingState` skips a value
   * that is `null` and loads one that is `''`, so a null said "this slide is gone" to a
   * receiver that then did nothing about it - the drawing stayed on screen until something
   * else happened to change that slide. Clearing with the pen already goes through the
   * ordinary path as `''`; this is the same thing said the same way. */
  for (const k of Object.keys(was)) {
    /* And it is NOT carried into `next`. Recording the cleared slide as an empty state left
     * it in `was` on the following frame, still absent from `data`, so the clear was emitted
     * again - and again, once per frame, for the rest of the lesson. Dropping the key is what
     * makes the removal happen exactly once. */
    if (!(k in data)) { patch[k] = { keep: 0, add: [], full: true }; any = true; }
  }
  return any ? { patch, next } : null;
}

/** Everything this tab believes the room holds, as one applicable-by-anybody snapshot. */
function snapshot(channel) {
  const patch = {};
  for (const [k, pieces] of Object.entries(sent[channel] || {})) {
    patch[k] = { keep: 0, add: pieces, full: true };
  }
  return Object.keys(patch).length ? patch : null;
}

/** Whether a patch is small enough to put on the wire at all. */
function within(channel, patch) {
  const size = JSON.stringify(patch).length;
  if (size <= CAP) return true;
  console.warn('decksync: dropping a patch for', channel, `- ${size} bytes is over the cap`);
  return false;
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
    const d = delta(channel, data);
    if (!d || !within(channel, d.patch)) continue;
    // Only once it has actually gone - see `put`. Otherwise the next diff skips it forever.
    if (put(channel, d.patch)) sent[channel] = d.next;
  }
  clearTimeout(settle);
  settle = setTimeout(resend, SETTLE);
}

/**
 * Once the hand stops: say again, in full, what the room should be holding.
 *
 * Not a diff and not conditional on anything having changed. It is what makes the deltas
 * above safe: a client that missed one - a socket between connections, a patch discarded as
 * stale, a student who joined after the drawing was made - is holding something a delta
 * cannot be applied to, declines it, and would stay behind for the rest of the lesson. A
 * snapshot needs nothing to be held already.
 *
 * The far side applies it over identical pieces in the ordinary case, so nothing happens.
 * Bounded by the annotated slides in the deck rather than by the length of the lesson, and
 * only once drawing has settled, so it is one message per stroke rather than per frame.
 */
function resend() {
  settle = null;
  for (const channel of Object.keys(sent)) {
    const patch = snapshot(channel);
    if (patch && within(channel, patch)) put(channel, patch);
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
    held = {};
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
 *
 * It runs on the REASSEMBLED slide rather than on each delta, because a piece of a delta is a
 * piece of a string and not markup - `chunked` cuts before opening tags without caring what
 * closes where, so a lone fragment is not something a filter could have an opinion about.
 */
const filtered = svg => (typeof svg === 'string' && svg ? clean(svg) : '');

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

/* What this client believes each slide holds, in the same pieces the sender cut it into.
 *
 * The receiving half of `sent`, and it has to exist here rather than be read back out of the
 * deck: Slidev owns that DOM, drauu rewrites it, and svgclean rebuilds every patch on the way
 * in - so what is on screen is not the string a delta was computed against and could not be
 * diffed against one. */
let held = {};

/**
 * A patch off the channel, on its way into the deck.
 *
 * WHO MAY BE SENT ONE IS THE CALLER'S QUESTION, not this file's - which is also what keeps
 * the two modules out of a cycle. delivery.js holds the session and knows whether this client
 * is the one leading; here there is only a deck and a patch.
 *
 * A DELTA THAT DOES NOT FIT WHAT WE HOLD IS DECLINED, not forced. `keep: 4` against two
 * pieces means messages were missed, and splicing anyway would silently interleave one
 * drawing into another - so it waits for the snapshot that follows every settled stroke.
 * Being briefly a stroke behind is honest; being wrong about which strokes were made is not.
 *
 * Applied whether or not this client is following, deliberately: annotations are drawn ON a
 * slide and are part of it while they are there. A student who has wandered a page ahead and
 * comes back should find what was drawn while they were gone, not a blank slide - the state
 * is keyed by slide number and Slidev renders whichever one is showing.
 */
export function applyDeck(channel, data, { origin, seq: n } = {}) {
  if (!fresh(channel, origin, n)) return;
  const keep = carried(channel, data);
  if (!keep) return;
  const mine = held[channel] || (held[channel] = {});
  const out = {};
  for (const [slide, d] of Object.entries(keep)) {
    if (d == null) { delete mine[slide]; out[slide] = null; continue; }
    /* A whole slide as a string is an older sender - one deployment behind, in a tab nobody
     * has reloaded. Taken at face value, because it is exactly what this used to send. */
    if (typeof d === 'string') { mine[slide] = chunked(d); out[slide] = filtered(d); continue; }
    if (!Array.isArray(d.add)) continue;
    const have = mine[slide] || [];
    if (!d.full && d.keep > have.length) continue;
    mine[slide] = (d.full ? [] : have.slice(0, d.keep)).concat(d.add);
    out[slide] = filtered(mine[slide].join(''));
  }
  if (Object.keys(out).length) intoDecks(channel, out);
}
