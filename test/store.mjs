/* THE LOCAL RECORD'S SHAPE, and the one part of it that is not a plain key/value.
 *
 * `progress-store.js` is the single definition of what `progress.js` and `preview.js` both
 * write, so a disagreement between them reads to a student as their work having been lost -
 * which is exactly why the shared-editor record is tested here rather than through the app.
 * It is pure but for `localStorage`, and a Map stands in for that in eight lines.
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
const store = await import('../app/src/progress-store.js');

let failures = 0;
const check = (what, ok, saw) => {
  if (ok) return console.log(`PASS  ${what}`);
  failures++;
  console.log(`FAIL  ${what}${saw === undefined ? '' : `  -- ${JSON.stringify(saw)}`}`);
};

const { saveShared, sharedFor, shared, forget } = store;

// ------------------------------------------------- what the educator wrote, per step
saveShared('sql', 'sept-eve', '101', 0, 'SELECT a;', 'Keith');
saveShared('sql', 'sept-eve', '101', 1, 'SELECT b;', 'Keith');
check('a demonstration is kept per step, like a draft',
      sharedFor('sql', 'sept-eve', '101')?.steps['1'] === 'SELECT b;',
      sharedFor('sql', 'sept-eve', '101'));
check('and remembers who wrote it, because the tab is named after them',
      sharedFor('sql', 'sept-eve', '101')?.by === 'Keith');

/* AN EXERCISE ID IS A NUMBER AND STORAGE ONLY EVER HANDS ONE BACK AS A STRING - the rule
 * `progressId` exists for. Both failures it caused elsewhere were live and silent. */
check('an id given as a number finds the same entry',
      sharedFor('sql', 'sept-eve', 101)?.steps['0'] === 'SELECT a;');

// ------------------------------------------------------------------- and per cohort
/* The point of the cohort key, and it is not the leak it first looks like: this store is
 * local, so cohort B's browser never receives cohort A's push. What it guards is the SAME
 * browser across intakes - somebody retaking a course with the next class. */
check('another intake sees nothing of this one', sharedFor('sql', 'jan-day', '101') === null);

await new Promise(r => setTimeout(r, 5));
saveShared('sql', 'jan-day', '101', 0, 'SELECT newer;', 'Someone Else');
check('and the two are kept side by side, not overwritten',
      sharedFor('sql', 'sept-eve', '101')?.steps['0'] === 'SELECT a;');
/* Outside a lesson there is no cohort to ask about, and the most recent is the last thing
 * this student was actually taught. The tab carries `by`, so they can see whose it is. */
check('with no lesson running, the most recent one wins',
      sharedFor('sql', null, '101')?.by === 'Someone Else', sharedFor('sql', null, '101'));

// ------------------------------------------------------------------------- bounded
/* Text from an editor going into a store that has no second chance when it fills. Counted
 * over every cohort at once: a bound counted per cohort would be three bounds for somebody
 * in three intakes. */
for (let i = 0; i < 60; i++) saveShared('sql', i % 2 ? 'a' : 'b', `ex${i}`, 0, 'x', 'K');
const kept = Object.values(shared('sql')).reduce((n, held) => n + Object.keys(held).length, 0);
check('the bound is over every intake at once, not one each', kept === 40, kept);
check('and the oldest went first', sharedFor('sql', 'sept-eve', '101') === null);

// A step longer than a very long answer is not kept at all - the draft rule, quoted.
saveShared('sql', 'a', 'huge', 0, 'x'.repeat(20001), 'K');
check('an absurd buffer is not kept', sharedFor('sql', 'a', 'huge') === null);

/* No cohort means no lesson, and a demonstration that belongs to no class is one nothing
 * could ever show again without breaking the rule above. */
saveShared('sql', null, '101', 0, 'nothing to attach this to', 'K');
check('a version with no cohort is not written',
      !JSON.stringify(shared('sql')).includes('nothing to attach'));

// ---------------------------------------------------------------- and forgotten
forget('sql');
check('resetting a course takes the demonstrations with it',
      JSON.stringify(shared('sql')) === '{}', shared('sql'));

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
