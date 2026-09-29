/* A message too big for one frame, cut into parts and put back together.
 *
 * PURE, SO IT NEEDS NO HARNESS - parts.js imports nothing, like walk.js and compare.js, and this
 * file is one of the things that keeps it that way.
 *
 * What it guards is a limit nobody sees until a lesson hits it: API Gateway closes a connection
 * that sends a frame over 32KB, and a browser sends a message as one frame. The deck's snapshot
 * crossed that within a few handwritten words and cut the educator's socket after every stroke.
 * So the one number that matters here is the size of every part ON THE WIRE, in bytes - and SVG
 * is mostly quotes, which double when a chunk of JSON is itself put inside JSON.
 */
import { split, assembler, bytes, PART_BYTES, MAX_PARTS } from '../app/src/parts.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

/* A deck snapshot the shape decksync.js sends: a slide of handwriting, cubic after cubic, every
 * attribute quoted. About 100KB. */
const stroke = i => `<path d="M 10,10 ${Array.from({ length: 200 }, (_, k) =>
  `C ${100 + k}.12,${200 + i}.34 ${110 + k}.56,${210 + i}.78 ${120 + k}.9,${220 + i}.1`).join(' ')}" fill="none" stroke="#e11"/>`;
const snapshot = { type: 'deck', channel: 'Deck - drawings', to: 'room', origin: 'tab', seq: 7,
                   data: { 5: { keep: 0, full: true, add: Array.from({ length: 8 }, (_, i) => stroke(i)) } } };
const text = JSON.stringify(snapshot);
const envelope = { type: 'part', of: 'deck', to: 'room' };

// ------------------------------------------------------------------- cutting
{
  const parts = split(text, envelope, 'tab-1');
  check('a 100KB snapshot is over one frame to begin with', bytes(text) > 32 * 1024, `${bytes(text)} bytes`);
  check('it becomes several parts', parts.length > 1, `${parts?.length}`);
  const sizes = parts.map(p => bytes(JSON.stringify(p)));
  check('EVERY part fits under the frame, measured in bytes on the wire',
        sizes.every(n => n <= PART_BYTES), `largest ${Math.max(...sizes)} of ${PART_BYTES}`);
  check('every part says what it is part of, and who it is for',
        parts.every(p => p.type === 'part' && p.of === 'deck' && p.to === 'room' && p.id === 'tab-1'));
  check('they are numbered 0..total-1 with the same total',
        parts.every((p, i) => p.n === i && p.total === parts.length));
}

/* Non-ASCII costs more than one byte a character, and the limit is bytes. A chat in Maltese
 * would be the natural way to meet this; the deck is the only type that splits, but the cutter
 * must not assume ASCII. */
{
  const wide = JSON.stringify({ text: 'ħġżċ'.repeat(20_000) });
  const parts = split(wide, envelope, 'wide');
  check('multi-byte text is sized in bytes too',
        parts.every(p => bytes(JSON.stringify(p)) <= PART_BYTES));
  const a = assembler();
  let whole = null;
  for (const p of parts) whole = a.add(p) ?? whole;
  check('and rejoins exactly', whole === wide);
}

// ------------------------------------------------------------------- joining
{
  const parts = split(text, envelope, 'tab-2');
  const a = assembler();
  const shuffled = [...parts].reverse();
  const answers = shuffled.map(p => a.add(p));
  check('nothing is delivered until the last part is in',
        answers.slice(0, -1).every(x => x === null));
  check('the whole message comes back byte for byte, in any arrival order',
        answers.at(-1) === text);
  check('and nothing is left waiting', a.waiting === 0);

  const b = assembler();
  b.add(parts[0]);
  check('a repeated part is ignored rather than counted twice', b.add(parts[0]) === null);
}

{
  const parts = split(text, envelope, 'tab-3');
  const a = assembler({ ttl: 5000 });
  for (const p of parts.slice(1)) a.add(p, 1000);
  check('a message missing a part yields nothing', a.waiting === 1);
  a.add({ ...parts[0], id: 'someone-else' }, 7000);
  check('and is forgotten once it is older than the ttl', a.waiting === 1,
        `${a.waiting} waiting - the stale one should have gone, leaving only the new one`);
}

{
  const a = assembler();
  check('a part that is not one is refused',
        a.add({ id: 'x', n: 3, total: 2, chunk: 'a' }) === null
        && a.add({ id: 'x', n: 0, total: MAX_PARTS + 1, chunk: 'a' }) === null
        && a.add(null) === null && a.waiting === 0);
  check('a message that would need too many parts is not split at all',
        split('x'.repeat(PART_BYTES * (MAX_PARTS + 4)), envelope, 'huge') === null);
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
