/* The Playground's Python session: the page's half.
 *
 * The interpreter and everything that talks to it is `playground-py.worker.js`; this file
 * decides when that worker exists and turns the Playground's questions into calls. See
 * worker-rpc.js for why a worker at all.
 */
import { spawn } from './worker-rpc.js';

const engine = spawn(() =>
  new Worker(new URL('./playground-py.worker.js', import.meta.url), { type: 'module' }));

let booted = null;

/** Has the interpreter been asked for yet, so the UI can say so without causing it. */
export const started = () => booted !== null;

/** Boot the interpreter, or wait for the boot already in flight. */
export const interpreter = () =>
  booted ??= engine.call('boot').catch(e => { booted = null; throw e; });

/**
 * Mount one set's files into the working directory.
 *
 * `files` are `{ course, module, name, as }` from the manifest and `urlFor` says where each
 * is published. The URL is made ABSOLUTE here, against the page: a relative one would resolve
 * against the worker's script, which lives somewhere else entirely.
 */
export async function addFiles(files, urlFor, { onStatus = () => {} } = {}) {
  onStatus(started() ? '' : 'Starting Python…');
  await interpreter();
  await engine.call('addFiles', {
    files: files.map(f => ({ as: f.as || f.name, url: new URL(urlFor(f), location.href).href })),
  }, { onStatus });
  onStatus('');
}

/**
 * Run the student's code. Returns `{ out, error, value, figures, ms }`; nothing throws for a
 * Python error, because a traceback is output. `onStatus` hears what is being loaded first.
 */
export async function run(code, { onStatus = () => {} } = {}) {
  onStatus(started() ? '' : 'Starting Python…');
  await interpreter();
  return engine.call('run', { code }, { onStatus });
}

/** Clear the namespace, close the figures and unmount the data. Not a new interpreter. */
export async function reset() {
  await interpreter();
  await engine.call('reset');
}

/** What the session currently holds - frames, their columns, and the mounted files. */
export async function shape() {
  await interpreter();
  return engine.call('shape');
}

/** One page of a frame or a mounted file - see `browse` in the worker. */
export async function browse(kind, name, { q = '', col = null, offset = 0, limit = 100 } = {}) {
  await interpreter();
  return engine.call('browse', { kind, name, q, col, offset, limit });
}

/**
 * End whatever Python is doing, and the session with it.
 *
 * The only way out of a `while True:`. Everything the student had - variables, loaded files,
 * imported packages - goes with the worker, so the next call boots a new interpreter. A run
 * in flight rejects with `message`, marked `stopped`.
 */
export function stop(message = 'Stopped.') {
  booted = null;
  engine.stop(message);
}
