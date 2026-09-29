/* THE EDITOR'S BEAT: how often what somebody is typing leaves the component.
 *
 * A THROTTLE, NOT A DEBOUNCE, and that difference was the lag a class watched. The beat was a
 * 160ms debounce: every keystroke restarted the timer, so anybody typing faster than one key per
 * 160ms - which is anybody typing - sent nothing until they paused. Measured in real browsers, a
 * line of code reached the class 4.8 seconds after the educator began it, whole, with nothing in
 * between.
 *
 * So: the first change goes on the next tick, then at most one send per `every` while changes
 * keep coming, and there is always a last send carrying the final state. The function is called
 * when the timer fires rather than when the change arrived, so whatever it reads is the latest.
 *
 * THE NEXT TICK RATHER THAN AT ONCE, because one keystroke is two events: the text changes and
 * the caret moves, a moment apart. Sent synchronously on the first, every keystroke would go out
 * twice, and the first copy would carry the caret from before it. A zero timer lets both land.
 *
 * ONE DEFINITION FOR BOTH EDITORS. CodingExercise and PythonExercise had identical copies of the
 * debounce, and two copies is how they would come to differ. Pure and dependency-free, so
 * test/beat.mjs imports it directly.
 */
export const EVERY = 100;

/**
 * `fn`, paced. Call the result on every change; call `.cancel()` when the component goes.
 *
 * Cancelled rather than flushed on the way out: a component unmounts because the row changed,
 * and a send fired after that would be read as belonging to the row that replaced it.
 */
export function beat(fn, every = EVERY) {
  let last = -Infinity;
  let timer = null;
  const run = () => { timer = null; last = Date.now(); fn(); };
  const poke = () => {
    if (timer !== null) return;   // one is already due, and it will carry this change
    timer = setTimeout(run, Math.max(0, last + every - Date.now()));
  };
  poke.cancel = () => { clearTimeout(timer); timer = null; };
  return poke;
}
