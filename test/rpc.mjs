/* What the page posts to a runtime's worker survives being posted.
 *
 * The first Run on the branch that moved Python and SQL into workers said "Proxy object could
 * not be cloned": the exercise came straight out of the app's reactive state, its arrays were
 * Vue Proxies, and postMessage cannot clone a Proxy. Every test then passed, because nothing
 * handed the runtimes a reactive object - the smoke page built plain ones by hand.
 *
 * So this posts a REACTIVE exercise through `spawn`, to a stand-in worker whose postMessage
 * does exactly what a browser's does to the message first: structuredClone it.
 */
import { reactive } from 'vue';
import { spawn, plain } from '../app/src/worker-rpc.js';

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  -- ${detail}`}`);
  if (!ok) failed++;
};

const exercise = reactive({
  id: 1, topic: '1.1.1', packages: ['pandas'], wheels: ['seaborn'], data: ['tiny.csv'],
  setup: 'import pandas as pd', nested: { steps: [{ solution: 'x = 1' }] },
});

{
  let cloned = null;
  check('a reactive object is what a browser refuses',
        (() => { try { structuredClone(exercise); return false; } catch { return true; } })());
  check('and plain() makes it one a browser accepts',
        (() => { try { cloned = structuredClone(plain(exercise)); return true; } catch { return false; } })());
  check('with every field intact',
        JSON.stringify(cloned) === JSON.stringify(exercise), JSON.stringify(cloned));
  const bytes = new Uint8Array([1, 2, 3]);
  check('a typed array passes through as itself, not rebuilt', plain({ bytes }).bytes === bytes);
}

/* The whole road: spawn -> postMessage -> the worker's answer. */
{
  const posted = [];
  const worker = {
    postMessage(message) {
      const copy = structuredClone(message);   // what the browser does, and where it threw
      posted.push(copy);
      queueMicrotask(() => this.onmessage({ data: { id: copy.id, value: copy.arg.packages } }));
    },
    terminate() {},
  };
  const engine = spawn(() => worker);
  let answer;
  try {
    answer = await engine.call('boot', { packages: exercise.packages, wheels: exercise.wheels });
  } catch (e) { answer = e.message; }
  check('a call carrying a reactive array reaches the worker', posted.length === 1, String(answer));
  check('and the worker sees the values', JSON.stringify(answer) === '["pandas"]', String(answer));
}

console.log(failed ? `\n${failed} failed` : '\nall green');
process.exit(failed ? 1 : 0);
