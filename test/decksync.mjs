/* What of a deck's own state travels to the class, and what must never.
 *
 * The relay is a pipe - it does not read what Slidev put in a channel, which is what keeps it
 * from being a commitment to Slidev's internal shape across upgrades. `carried` is the one
 * place that has an opinion, and the opinion is small and load-bearing enough to pin down
 * here: annotations in full, the click step, and NOT the page.
 *
 * Dropping `page` is the assertion that matters. Where the class is looking already has one
 * authority - the room reports the educator's position, the walk resolves it to a row, and
 * SlidesStep drives the frame and clamps it to the topic. A synced page would be a second,
 * and not merely a duplicate: a page past the clamp is pushed back, re-sent and pushed back
 * again. That is a loop nobody would read as a sync problem, so it gets a test rather than a
 * comment.
 *
 * `decksync.js` imports nothing, deliberately, so this can import it directly the way
 * walk.mjs and pointer.mjs do theirs. The relay half needs `addEventListener` and a
 * `location`, which is all - far short of a DOM, so they are stubbed here rather than met
 * with jsdom.
 */
const listeners = new Set();
globalThis.location = { origin: 'https://icecore.test' };
globalThis.addEventListener = (t, fn) => { if (t === 'message') listeners.add(fn); };
globalThis.removeEventListener = (t, fn) => { if (t === 'message') listeners.delete(fn); };
globalThis.dispatchEvent = e => { for (const fn of listeners) fn(e); return true; };
globalThis.Event = class { constructor(type) { this.type = type; } };
/* A deck on screen, or not, depending on what is under test. The relay half wants no frame;
 * the receiving half needs one to post into, and what it posts is the assertion. */
let posted = [];
let deck = [];
globalThis.document = { querySelectorAll: () => deck };
const withDeck = () => {
  posted = [];
  deck = [{ contentWindow: { postMessage: m => posted.push(m) } }];
};
import { carried, watchDecks, applyDeck } from '../app/src/decksync.js';

/* THE NAME SLIDEV ACTUALLY USES. `setup/root.ts` names each channel after the deck -
 * `${slidesTitle} - shared` and `${slidesTitle} - drawings` - so a relay keyed on the bare
 * word matched nothing that ever arrived, and every annotation was dropped one line into
 * the filter. The whole name travels; only the suffix is read. */
const TITLE = 'Python for ONEY \u2014 1.1 Using NumPy - Slidev';
const DRAWINGS = `${TITLE} - drawings`;
const SHARED = `${TITLE} - shared`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

// ------------------------------------------------------------- what travels
{
  const drawings = { 3: '<svg>one</svg>', 7: '<svg>two</svg>' };
  check('annotations travel whole, keyed by slide',
        JSON.stringify(carried(DRAWINGS, drawings)) === JSON.stringify(drawings),
        JSON.stringify(carried(DRAWINGS, drawings)));
}

/* NOTHING OFF THE SHARED CHANNEL TRAVELS, AND THAT IS A DECISION RATHER THAN AN OMISSION.
 *
 * The click step used to be carried from here and it never once worked: Slidev only writes
 * `clicks` into that channel from a presenter or from a TRUSTED ORIGIN - localhost and
 * 127.0.0.1 - so on our own domain the channel never changes and there is nothing to relay.
 * A whole lesson on the wire produced not one `- shared` frame.
 *
 * It could only have done harm if it had fired. `page` must never travel - the room already
 * says where the class is looking - and the receiving deck applies a shared patch through
 * Slidev's own `onPatch`, which navigates to `state.page`. That would have been the default
 * 1: a patch about clicks sending a student to the first slide of the deck, through
 * `history.replaceState`, which fires no event for the clamp to catch. */
{
  const state = { page: 12, clicks: 3, clicksTotal: 5, timer: { status: 'running' } };
  check('nothing off the shared channel is relayed',
        carried(SHARED, state) === null, JSON.stringify(carried(SHARED, state)));
  /* THE ONE THAT MATTERS, stated on its own so it survives the day somebody makes the
   * shared channel work properly: whatever else travels, the page does not. */
  check('and the page above all', carried(SHARED, { page: 12 }) === null);
}

// ------------------------------------------------- channels nobody asked for
{
  check('the bare word is not a channel - it never arrives that way',
        carried('drawings', { 3: '<svg/>' }) === null);
  check('an unknown channel is not relayed', carried(`${TITLE} - snapshot`, { a: 1 }) === null);
  check('and neither is a missing one', carried(undefined, { a: 1 }) === null);
  /* The theme announces a channel with a null body when a deck starts listening. It is not a
   * state and must not be forwarded as one. */
  check('an announcement is not a patch', carried(DRAWINGS, null) === null);
  check('nor is something that is not an object', carried(DRAWINGS, 'oops') === null);
}

// ------------------------------------------------- what actually goes on the wire
/* SLIDEV HANDS OVER THE WHOLE CHANNEL on every change, so without a diff every stroke
 * re-sends every annotated slide in the deck - a message that grows for the length of a
 * lesson and takes the socket with it when it passes API Gateway's frame limit. The relay
 * sends differences, and a difference includes an annotation being RUBBED OUT. */
{
  const seen = [];
  const stop = watchDecks(() => 'room', (...args) => seen.push(args));
  const post = data => dispatchEvent(Object.assign(new Event('message'), {
    origin: 'https://icecore.test', data: { kind: 'ice:deck-sync', channel: DRAWINGS, data },
  }));

  const A = '<path d="M1,1"/>';
  const B = '<path d="M2,2"/>';
  const C = '<path d="M3,3"/>';

  post({ 3: A });
  post({ 3: A, 7: B });
  await new Promise(r => setTimeout(r, 160));
  check('the first patch carries the slides that were drawn on',
        seen.length === 1
          && JSON.stringify(seen[0][1]) === JSON.stringify({ 3: { keep: 0, add: [A] },
                                                             7: { keep: 0, add: [B] } }),
        JSON.stringify(seen[0]?.[1]));

  seen.length = 0;
  post({ 3: A, 7: B + C });
  await new Promise(r => setTimeout(r, 160));
  check('and the next carries ONLY the new stroke, not the slide it is on',
        seen.length === 1
          && JSON.stringify(seen[0][1]) === JSON.stringify({ 7: { keep: 1, add: [C] } }),
        JSON.stringify(seen[0]?.[1]));

  seen.length = 0;
  post({ 3: A, 7: B });
  await new Promise(r => setTimeout(r, 160));
  check('undoing one keeps what is left and adds nothing',
        seen.length === 1
          && JSON.stringify(seen[0][1]) === JSON.stringify({ 7: { keep: 1, add: [] } }),
        JSON.stringify(seen[0]?.[1]));

  seen.length = 0;
  post({ 3: A });
  await new Promise(r => setTimeout(r, 160));
  check('a slide dropped from the channel is cleared rather than left standing',
        seen.length === 1 && seen[0][1][7]?.full === true && !seen[0][1][7].add.length,
        JSON.stringify(seen[0]?.[1]));

  seen.length = 0;
  post({ 3: A });
  await new Promise(r => setTimeout(r, 160));
  check('and saying the same thing twice sends nothing at all',
        seen.length === 0, JSON.stringify(seen));

  /* THE BUG THIS FILE EXISTS FOR NOW. The cap used to be 24KB measured against the SLIDE, and
   * a slide only grows - so one cursive word tipped it over and every later frame was skipped
   * too, permanently. A delta is the size of the stroke, so the same drawing goes through. */
  seen.length = 0;
  const CURSIVE = `<path d="M1,1 ${'C 123.45,678.90 123.45,678.90 123.45,678.90 '.repeat(600)}"/>`;
  check('one cursive word really is bigger than the old cap',
        CURSIVE.length > 24 * 1024, `${CURSIVE.length} bytes`);
  post({ 3: A + CURSIVE });
  await new Promise(r => setTimeout(r, 160));
  check('a slide bigger than the old cap still travels',
        seen.length === 1 && seen[0][1][3]?.add?.[0] === CURSIVE,
        JSON.stringify(seen[0]?.[1]).slice(0, 90));

  seen.length = 0;
  post({ 3: A + CURSIVE + B });
  await new Promise(r => setTimeout(r, 160));
  check('AND SO DOES THE NEXT STROKE AFTER IT - the wedge is gone',
        seen.length === 1
          && JSON.stringify(seen[0][1]) === JSON.stringify({ 3: { keep: 2, add: [B] } }),
        JSON.stringify(seen[0]?.[1]));
  check('and it costs the stroke rather than the slide',
        JSON.stringify(seen[0][1]).length < 100, JSON.stringify(seen[0][1]).length + ' bytes');

  /* ---- AND ONE MORE ONCE THE HAND STOPS ---------------------------------
   *
   * Everything above is a diff, so a frame that never arrives is never offered again: the
   * sender has already recorded that key as sent. Two things drop frames - a socket between
   * connections, and the ordering below discarding a patch that lost its race - and both
   * leave the room one stroke short of what was drawn. The settle resend is what heals that,
   * and it is worth a test because nothing on screen would ever show it working. */
  seen.length = 0;
  post({ 3: A, 7: C });
  await new Promise(r => setTimeout(r, 160));
  check('a change goes out as a delta',
        seen.length === 1 && seen[0][1][7]?.add?.[0] === C && !seen[0][1][7].full,
        JSON.stringify(seen[0]?.[1]));
  await new Promise(r => setTimeout(r, 700));
  check('and once drawing settles the whole state is said again, as a snapshot',
        seen.length === 2
          && JSON.stringify(seen[1][1]) === JSON.stringify({
               3: { keep: 0, add: [A], full: true },
               7: { keep: 0, add: [C], full: true } }),
        JSON.stringify(seen[1]?.[1]));

  /* IT IS STAMPED, and the stamp is the only thing that can order these: every frame is its
   * own concurrent Lambda invocation and API Gateway orders nothing between them. */
  check('every patch carries the sending tab and a rising count',
        seen.every(x => x[3]?.origin) && seen[1][3].seq > seen[0][3].seq,
        JSON.stringify(seen.map(x => x[3])));
  check('and one tab is one origin', seen[0][3].origin === seen[1][3].origin);

  /* A SEND THAT DID NOT GO IS NOT A SEND. `send` in live.js drops silently when there is no
   * socket, and believing it would mean the diff never offers that key again - a stroke
   * drawn during a reconnection lost for the rest of the lesson rather than for a second. */
  stop();
}
{
  const seen = [];
  let delivered = false;
  const stop = watchDecks(() => 'room', (channel, data, to, meta) => {
    seen.push([channel, data, to, meta]);
    return delivered;
  });
  const post = data => dispatchEvent(Object.assign(new Event('message'), {
    origin: 'https://icecore.test', data: { kind: 'ice:deck-sync', channel: DRAWINGS, data },
  }));

  const A2 = '<path d="M1,1"/>';
  post({ 3: A2 });
  await new Promise(r => setTimeout(r, 160));
  delivered = true;
  post({ 3: A2 });
  await new Promise(r => setTimeout(r, 160));
  check('a patch the socket refused is offered again rather than recorded as sent',
        seen.length === 2 && seen[1][1][3]?.add?.[0] === A2,
        JSON.stringify(seen.map(x => x[1])));
  stop();
}

// ------------------------------------------------- and what arrives out of order
/* THE FOURTH SIDE OF THE SQUARE. A drawing patch is last-write-wins whole-slide SVG and the
 * frames race each other, so a stroke's final frame landing before an earlier one leaves the
 * older drawing on screen - which is what "I drew a square and only three sides appeared"
 * was. Nothing on the wire can be ordered, so the sender counts and this drops what is
 * behind. */
{
  withDeck();
  /* WHETHER IT REACHES THE DECK AT ALL is the whole of this rule, so that is what is counted.
   * What the deck is then handed is svgclean's business - filtered on the way in, covered by
   * svgclean.mjs, and not reproducible here: this file stubs far short of a DOM and `clean`
   * needs a real `DOMParser`, so every value arrives empty whatever went in. */
  const ink = x => `<path d="M${x},180 L520,180" stroke="#1f2328" stroke-width="6"/>`;
  const patch = (n, x) => applyDeck(DRAWINGS, { 3: ink(x) }, { origin: 'tab-a', seq: n });
  patch(1, 100);
  patch(2, 200);
  check('a patch in order is applied',
        posted.length === 2 && posted[1].channel === DRAWINGS,
        JSON.stringify(posted.map(p => p.channel)));
  patch(1, 100);
  check('and one that lost its race is dropped rather than undoing the newer one',
        posted.length === 2, String(posted.length));
  patch(3, 300);
  check('while the next one through still lands', posted.length === 3);

  /* TWO TABS ARE TWO COUNTERS. An educator's room tab and their control tab know nothing of
   * each other and a student being helped hears both; merged into one counter, whichever tab
   * was behind would stop drawing entirely. */
  applyDeck(DRAWINGS, { 3: ink(400) }, { origin: 'tab-b', seq: 1 });
  check('a second tab counts on its own', posted.length === 4);

  /* An older deployment stamps nothing, and an unordered patch is worth far more applied
   * than discarded. */
  applyDeck(DRAWINGS, { 3: ink(500) }, {});
  check('an unstamped patch is applied rather than refused', posted.length === 5);
  deck = [];
}

// ------------------------------------------------- and a delta is reassembled
/* The receiving half of the delta. What crosses into the deck has to be the WHOLE slide -
 * Slidev hands it to drauu's `load()`, which replaces - so this client keeps the pieces and
 * joins them. Content is not asserted here: `filtered` runs svgclean on the way out and this
 * file stubs far short of the DOM that needs, so every value arrives empty whatever went in.
 * What is asserted is the bookkeeping, which is where a delta can be wrong. */
{
  withDeck();
  let n = 1;
  const one = x => `<path d="M${x},1"/>`;
  const send = (slide, d) => applyDeck(DRAWINGS, { [slide]: d }, { origin: 'tab-z', seq: n++ });
  const pieces = () => posted[posted.length - 1]?.data;

  send(3, { keep: 0, add: [one(1)] });
  check('a snapshot with nothing held is applied', posted.length === 1);

  send(3, { keep: 1, add: [one(2)] });
  check('and a delta on top of it is applied', posted.length === 2);

  /* THE CASE THAT MAKES DELTAS SAFE. Three pieces held against a delta that expects five
   * means messages went missing - a reconnection, a patch that lost its race, a student who
   * joined after the drawing was made. Splicing anyway would interleave one drawing into
   * another and look like the educator had drawn something they did not. */
  send(3, { keep: 5, add: [one(9)] });
  check('a delta that does not fit what is held is DECLINED, not forced',
        posted.length === 2, `${posted.length} posts`);

  /* And the snapshot that follows every settled stroke is what closes the gap. */
  send(3, { keep: 0, add: [one(1), one(2), one(3)], full: true });
  check('and the snapshot after it puts them right', posted.length === 3);

  send(3, { keep: 3, add: [one(4)] });
  check('after which deltas fit again', posted.length === 4);

  /* Clearing a slide is a snapshot of nothing, and it has to REACH the deck: Slidev loads an
   * empty string and ignores a null, so this is what actually rubs a drawing out. */
  send(3, { keep: 0, add: [], full: true });
  check('clearing a slide reaches the deck as an empty slide',
        posted.length === 5 && pieces()[3] === '', JSON.stringify(pieces()));

  /* A whole slide as a plain string is an older sender - one deployment behind, in a tab
   * nobody has reloaded. It has to keep working, and it has to reset the bookkeeping. */
  send(7, one(1) + one(2));
  check('a whole-slide string from an older sender is still applied', posted.length === 6);
  send(7, { keep: 2, add: [one(3)] });
  check('and a delta lands on top of what it left behind', posted.length === 7);
  deck = [];
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
