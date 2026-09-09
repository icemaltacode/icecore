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

  post({ 3: '<svg>a</svg>' });
  post({ 3: '<svg>a</svg>', 7: '<svg>b</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('the first patch carries the slide that was drawn on',
        seen.length === 1 && JSON.stringify(seen[0][1]) === JSON.stringify({ 3: '<svg>a</svg>', 7: '<svg>b</svg>' }),
        JSON.stringify(seen));

  seen.length = 0;
  post({ 3: '<svg>a</svg>', 7: '<svg>b2</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('and the next carries ONLY what changed, not the whole deck',
        seen.length === 1 && JSON.stringify(seen[0][1]) === JSON.stringify({ 7: '<svg>b2</svg>' }),
        JSON.stringify(seen));

  seen.length = 0;
  post({ 3: '<svg>a</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('rubbing one out is a change too', 
        seen.length === 1 && seen[0][1][7] === null, JSON.stringify(seen));

  seen.length = 0;
  post({ 3: '<svg>a</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('and saying the same thing twice sends nothing at all',
        seen.length === 0, JSON.stringify(seen));

  /* Slide 3 is carried through unchanged, so the only NEW thing here is the oversized one -
   * otherwise this would be watching slide 3 be removed and calling it a drop. */
  seen.length = 0;
  post({ 3: '<svg>a</svg>', 9: `<svg>${'x'.repeat(30000)}</svg>` });
  await new Promise(r => setTimeout(r, 160));
  check('a slide too big for a frame is dropped rather than sent',
        seen.length === 0, JSON.stringify(seen).slice(0, 80));

  /* ---- AND ONE MORE ONCE THE HAND STOPS ---------------------------------
   *
   * Everything above is a diff, so a frame that never arrives is never offered again: the
   * sender has already recorded that key as sent. Two things drop frames - a socket between
   * connections, and the ordering below discarding a patch that lost its race - and both
   * leave the room one stroke short of what was drawn. The settle resend is what heals that,
   * and it is worth a test because nothing on screen would ever show it working. */
  seen.length = 0;
  post({ 3: '<svg>a</svg>', 7: '<svg>c</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('a change goes out as a diff', seen.length === 1 && seen[0][1][7] === '<svg>c</svg>',
        JSON.stringify(seen));
  await new Promise(r => setTimeout(r, 700));
  check('and once drawing settles the whole state is said again, in full',
        seen.length === 2
          && JSON.stringify(seen[1][1]) === JSON.stringify({ 3: '<svg>a</svg>', 7: '<svg>c</svg>' }),
        JSON.stringify(seen.map(x => x[1])));

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

  post({ 3: '<svg>a</svg>' });
  await new Promise(r => setTimeout(r, 160));
  delivered = true;
  post({ 3: '<svg>a</svg>' });
  await new Promise(r => setTimeout(r, 160));
  check('a patch the socket refused is offered again rather than recorded as sent',
        seen.length === 2 && seen[1][1][3] === '<svg>a</svg>', JSON.stringify(seen.map(x => x[1])));
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

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
