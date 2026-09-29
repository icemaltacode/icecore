/* The editor's beat - app/src/beat.js. Pure, so imported directly.
 *
 * TIMING MARGINS ARE GENEROUS ON PURPOSE. What matters is the shape: one send straight away, a
 * steady trickle while changes keep coming, and a last send carrying the final value. A test that
 * asserted exact counts would fail on a busy machine and teach everybody to ignore it.
 */
import { beat } from '../app/src/beat.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- a burst of typing
{
  let value = 0;
  const sent = [];
  const t0 = Date.now();
  const poke = beat(() => sent.push({ value, t: Date.now() - t0 }), 100);
  for (let i = 1; i <= 20; i++) {
    value = i;
    poke();
    await sleep(20);
  }
  await sleep(250);

  check('the first change goes at once', sent.length > 0 && sent[0].t < 60,
        JSON.stringify(sent[0]));
  /* Twenty changes over ~400ms: a debounce sends 1, a throttle about 5. */
  check('and more go while the typing carries on', sent.length >= 3 && sent.length <= 8,
        `${sent.length} sends: ${JSON.stringify(sent)}`);
  check('never two within the interval of each other',
        sent.every((s, i) => i === 0 || s.t - sent[i - 1].t >= 90),
        JSON.stringify(sent.map(s => s.t)));
  check('and the last one carries the final value', sent.at(-1)?.value === 20,
        JSON.stringify(sent.at(-1)));
  const before = sent.length;
  await sleep(250);
  check('then it goes quiet', sent.length === before, `${sent.length} sends, was ${before}`);
}

// ---------------------------------------------------------------- one change
{
  const sent = [];
  const poke = beat(() => sent.push(Date.now()), 100);
  poke();
  await sleep(250);
  check('a single change is sent exactly once', sent.length === 1, `${sent.length} sends`);
}

// ---------------------------------------------------------------- one keystroke is two events
{
  let text = 'a', caret = 1;
  const sent = [];
  const poke = beat(() => sent.push({ text, caret }), 100);
  // The text changes, then the caret moves - the order an editor reports them in.
  text = 'ab'; poke();
  caret = 2; poke();
  await sleep(50);
  check('the text and the caret of one keystroke leave together, once',
        sent.length === 1 && sent[0].text === 'ab' && sent[0].caret === 2, JSON.stringify(sent));
}

// ---------------------------------------------------------------- and going away
{
  const sent = [];
  const poke = beat(() => sent.push(1), 100);
  poke();
  await sleep(20);
  poke();          // due in ~80ms
  poke.cancel();
  await sleep(200);
  check('cancelling drops what was due', sent.length === 1, `${sent.length} sends`);
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
