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
 * walk.mjs and pointer.mjs do theirs.
 */
import { carried } from '../app/src/decksync.js';

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

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
