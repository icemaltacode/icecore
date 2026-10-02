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

/* THE PLAYGROUND'S PYTHON, when it would not start.
 *
 * The worker remembers its own boot, failure and all, and the page used to forget it alone:
 * every retry went to the same worker for the same rejection, so Run could not start Python
 * again until Stop or a reload. A boot that failed now ends its worker.
 *
 * THE OTHER HALF IS A STOP DURING A BOOT. The Playground boots again straight after a Stop,
 * so the stopped boot's rejection arrives with a NEW boot already in `booted`. Clearing that
 * would forget it, and ending the engine would kill it. */
{
  const made = [];
  let answer = 'fail';   // how a boot is answered: 'fail', 'ok', or 'hold' (not at all)
  globalThis.Worker = class {
    constructor() { made.push(this); this.terminated = false; }
    postMessage({ id, op }) {
      if (op === 'boot' && answer === 'hold') return;
      const data = op === 'boot' && answer === 'fail'
        ? { id, error: { message: 'Program terminated with exit(1)' } }
        : { id, value: true };
      queueMicrotask(() => this.onmessage({ data }));
    }
    terminate() { this.terminated = true; }
  };
  const pg = await import('../app/src/playground-py.js');

  let said = '';
  await pg.interpreter().catch(e => { said = e.message; });
  check('a Playground Python that would not start says why', /exit\(1\)/.test(said), said);
  check('and its worker is ended', made[0]?.terminated === true);
  check('and nothing claims to have started', !pg.started());

  answer = 'ok';
  await pg.interpreter();
  check('so Run tries again in a NEW worker, rather than asking the failed one',
        made.length === 2 && !made[1].terminated, `${made.length} made`);

  pg.stop('Stopped.');
  answer = 'hold';
  const first = pg.interpreter();
  pg.stop('Stopped.');                // a Stop while that boot is in flight
  answer = 'ok';
  const second = pg.interpreter();    // and the boot that follows every Stop
  await first.catch(() => {});
  await second;
  check('a boot stopped mid-way does not end the boot that followed the Stop',
        !made.at(-1).terminated && pg.started(),
        `last terminated: ${made.at(-1).terminated}, started: ${pg.started()}`);
  delete globalThis.Worker;
}

console.log(failed ? `\n${failed} failed` : '\nall green');
process.exit(failed ? 1 : 0);
