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
// Nothing is on screen, so no deck is ever posted into. The relay is what is under test.
globalThis.document = { querySelectorAll: () => [] };
import { carried, watchDecks } from '../app/src/decksync.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

// ------------------------------------------------------------- what travels
{
  const drawings = { 3: '<svg>one</svg>', 7: '<svg>two</svg>' };
  check('annotations travel whole, keyed by slide',
        JSON.stringify(carried('drawings', drawings)) === JSON.stringify(drawings),
        JSON.stringify(carried('drawings', drawings)));
}

{
  const state = { page: 12, clicks: 3, clicksTotal: 5, timer: { status: 'running' } };
  const out = carried('shared', state);
  check('the click step travels', out.clicks === 3 && out.clicksTotal === 5, JSON.stringify(out));
  /* THE ONE THAT MATTERS. */
  check('and the page does NOT', !('page' in out), JSON.stringify(out));
  check('nor the timer, which nothing shows', !('timer' in out), JSON.stringify(out));
}

{
  /* A patch carrying only a page is nothing to send at all - not an empty object, which
   * would be a message the other side has to receive and discard. */
  check('a patch of nothing but the page is not sent',
        carried('shared', { page: 12 }) === null,
        JSON.stringify(carried('shared', { page: 12 })));
}

// ------------------------------------------------- channels nobody asked for
{
  check('an unknown channel is not relayed', carried('snapshot', { a: 1 }) === null);
  check('and neither is a missing one', carried(undefined, { a: 1 }) === null);
  /* The theme announces a channel with a null body when a deck starts listening. It is not a
   * state and must not be forwarded as one. */
  check('an announcement is not a patch', carried('shared', null) === null);
  check('nor is something that is not an object', carried('drawings', 'oops') === null);
}

// ------------------------------------------------- what actually goes on the wire
/* SLIDEV HANDS OVER THE WHOLE CHANNEL on every change, so without a diff every stroke
 * re-sends every annotated slide in the deck - a message that grows for the length of a
 * lesson and takes the socket with it when it passes API Gateway's frame limit. The relay
 * sends differences, and a difference includes an annotation being RUBBED OUT. */
{
  const seen = [];
  const stop = watchDecks(() => 'room', (channel, data) => seen.push([channel, data]));
  const post = data => dispatchEvent(Object.assign(new Event('message'), {
    origin: 'https://icecore.test', data: { kind: 'ice:deck-sync', channel: 'drawings', data },
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

  stop();
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
