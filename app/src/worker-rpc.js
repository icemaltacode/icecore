/* BOTH SIDES OF ONE CONVERSATION WITH A WORKER: the player asks, the worker answers.
 *
 * WHY THE RUNTIMES LIVE IN WORKERS. Pyodide and PGlite run synchronously in whatever thread
 * calls them, and they used to be called from the page's own. Importing pandas held the page
 * for a second or two, a student's `while True:` held it for good, and nothing could stop
 * either: code running on a thread cannot be interrupted from that same thread. In a worker
 * the page keeps moving (the lesson's channel, the editor, the deck) and the player can end a
 * run from outside by terminating the worker. Terminating also hands back the whole of its
 * wasm heap at once, which dropping the reference to an interpreter never reliably did.
 *
 * PURE, like compare.js: no imports and nothing from Vite, so either side reads alone.
 *
 * WHAT CROSSES IS DATA, NEVER A HANDLE. A Pyodide proxy or a PGlite instance cannot leave
 * its worker, so every answer is a plain object by the time it is posted, which is what
 * every caller wanted from them anyway.
 *
 * ONE ARGUMENT PER CALL, an object. A handler is also handed a context after it, and with
 * positional arguments an omitted optional one would put the context in its place.
 */

/* ---- the worker's side ------------------------------------------------------------- */

const MOVING = Symbol('moving');

/** Answer with `value`, moving these buffers to the page rather than copying them. */
export const moving = (value, buffers) => ({ [MOVING]: buffers, value });

/* An error crosses as its message and the fields Postgres puts on one. A stack does not
 * survive the trip usefully, and an Error's prototype does not survive it at all. */
const describe = e => ({
  message: String(e?.message ?? e), name: e?.name, code: e?.code, position: e?.position,
});

/**
 * Answer the page's calls with `handlers`, each `(arg, { status }) => value | Promise`.
 * `status(text)` tells the caller what is happening while it waits, before anything slow.
 */
export function serve(handlers) {
  self.onmessage = async ({ data: { id, op, arg } }) => {
    const status = text => self.postMessage({ id, status: text });
    try {
      if (!handlers[op]) throw new Error(`no such operation: ${op}`);
      let value = await handlers[op](arg, { status });
      let transfer = [];
      if (value && value[MOVING]) { transfer = value[MOVING]; value = value.value; }
      self.postMessage({ id, value }, transfer);
    } catch (e) {
      self.postMessage({ id, error: describe(e) });
    }
  };
}

/* ---- the page's side ------------------------------------------------------------- */

/* WHAT IS POSTED IS COPIED HERE FIRST, out of whatever Vue wrapped it in. An exercise reaches
 * the runtimes straight from the app's reactive state, so its `packages`, `wheels` and `data`
 * are Vue Proxies - and a Proxy cannot be structured-cloned: postMessage refuses it with
 * "Proxy object could not be cloned", which is what every Run and Check said on the first
 * day. Done once, here, rather than at each call site, because the next caller to hand over
 * a prop would meet it again. Arrays and plain objects are rebuilt (a reactive one still
 * answers Array.isArray and still has Object's prototype); everything else - strings, numbers,
 * typed arrays, which Vue never wraps - passes through as it is. */
export const plain = v => {
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null)
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

/**
 * A worker made on first use, and made again after it has been stopped or has died.
 *
 * `make` is `() => new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' })`,
 * written out at each call site because that literal is what Vite looks for to bundle a
 * worker. Nothing is made until the first call, and the first call is always inside an
 * async function, so a page with no Worker at all (jsdom) gets a rejection to catch rather
 * than a throw in the middle of a component's setup.
 */
export function spawn(make) {
  let worker = null;
  let next = 0;
  const pending = new Map();

  const fail = err => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  const drop = () => { worker?.terminate(); worker = null; };

  const open = () => {
    if (worker) return worker;
    const w = make();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if ('status' in data) { p.onStatus?.(data.status); return; }
      pending.delete(data.id);
      if (data.error) p.reject(Object.assign(new Error(data.error.message), data.error));
      else p.resolve(data.value);
    };
    /* A worker that DIED rather than answered: its script failed to load, or something threw
     * outside any call. Everything in flight fails with it, and the next call makes a new
     * worker rather than posting to one that will never answer. */
    w.onerror = e => {
      e.preventDefault?.();
      if (worker !== w) return;
      drop();
      fail(new Error(e.message || 'The runtime stopped unexpectedly.'));
    };
    worker = w;
    return w;
  };

  return {
    /** Ask the worker to do `op`. Rejects with the worker's own error, `code` and all. */
    async call(op, arg, { onStatus, transfer = [] } = {}) {
      const w = open();
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onStatus });
        w.postMessage({ id, op, arg: plain(arg) }, transfer);
      });
    },

    /**
     * End the worker NOW, whatever it is in the middle of. Everything in flight rejects with
     * `why`, marked `stopped` so that a caller can tell a stop from a failure: a stopped run
     * is not a wrong answer, and must not be reported as one.
     */
    stop(why) {
      if (!worker) return;
      drop();
      fail(Object.assign(new Error(why), { stopped: true }));
    },
  };
}
