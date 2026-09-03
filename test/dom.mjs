/* A DOM for the player to be mounted into.
 *
 * ONE JSDOM WINDOW, PROMOTED TO GLOBALS. Vue reads `document` and `window` off the global
 * object, and so does every module in `app/src` that listens for a keystroke or reads a
 * hash - so a window held in a variable would be a window nothing under test can see.
 *
 * WHAT IS STUBBED IS ONLY WHAT JSDOM DOES NOT HAVE, and each one is named rather than
 * swept up by a proxy: `matchMedia` (jsdom has none, and `styles.css`'s reduced-motion
 * query is read from script), `fetch` (the content manifest - see `serve` below) and
 * `WebSocket` (there is no channel here; the preview's scripted room delivers through
 * `emitLocal` instead, which is `live.js`'s own dispatcher). A stub that pretends to be
 * more than that would be a test of the stub.
 */
import { JSDOM } from 'jsdom';

/**
 * Install a DOM. Returns `{ dom, serve, restore }`.
 *
 * `hash` is the route the app opens on, because the route IS a place here - `#/live/<id>`
 * is how a client is in a session at all, and a test that had to click its way to one would
 * be testing the buttons rather than the screen. `search` is the same argument one level up:
 * `?course=<id>` is what makes returning to a tab resume where it was.
 */
export function installDom({ hash = '', search = '', url = 'https://icecore.test/' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: url + search + hash,
    pretendToBeVisual: true,
  });
  const { window } = dom;

  /* jsdom has no matchMedia at all, and `undefined()` is what a component reading a media
   * query gets. Answers "no" to everything: `prefers-reduced-motion` false is the ordinary
   * case, and a colour-scheme query answering true would put the app in a theme nothing
   * here is asserting about. */
  window.matchMedia = q => ({
    media: q, matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });

  /* No channel. `live.js` opens one only when `socketUrl()` is set, which needs an
   * auth.json - so under preview nothing ever constructs this. It exists so that a module
   * comparing `readyState` to `WebSocket.OPEN` at import time does not throw. */
  window.WebSocket = class { static OPEN = 1; constructor() { this.readyState = 3; } close() {} };

  /* EVERY GLOBAL THE WINDOW HAS, rather than a list of the ones somebody remembered.
   *
   * The list was the first version and it does not work: Vue's own runtime reaches for
   * `SVGElement` on mount, `MathMLElement` beside it, and a component that touches
   * `DocumentFragment` or `Text` would each add another name to a list nobody would think
   * to add to until the day it threw. A window's job is to be a complete set of these, so
   * the whole set is what gets promoted.
   *
   * The deny-list is short and every entry is there for a reason:
   *  - the DELEGATES  jsdom implements some of these by calling the ones on the global
   *                   object, so promoting them makes each call itself. `btoa` surfaces as
   *                   InvalidCharacterError on plain ASCII - which reads as the string being
   *                   wrong rather than the wiring - and `performance.now` as a stack
   *                   overflow. All of them are Node natives already and identical, so
   *                   leaving them alone loses nothing.
   *  - the timers     jsdom's belong to the window and stop when it closes; a test that
   *                   awaits anything after `restore()` would then hang forever.
   *  - `fetch`        replaced below, deliberately, so an unserved path is loud.
   */
  const DENY = new Set(['btoa', 'atob', 'performance', 'crypto', 'structuredClone',
                        'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
                        'fetch',
                        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
                        'setImmediate', 'clearImmediate', 'queueMicrotask']);
  const saved = new Map();
  const put = (k, value) => {
    const had = Object.getOwnPropertyDescriptor(globalThis, k);
    /* Some of them cannot be redefined at all - `Infinity`, `NaN`, `undefined` are
     * non-configurable on the global object by specification. They are also identical in
     * both realms, so skipping them costs nothing. */
    if (had && !had.configurable && !had.writable) return;
    if (!saved.has(k)) saved.set(k, had);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value });
  };
  for (const k of Object.getOwnPropertyNames(window)) {
    if (DENY.has(k)) continue;
    // Some of a window's own properties are accessors that throw when read off-thread;
    // none that does is worth a global, so a failure here is simply not promoted.
    let value;
    try { value = window[k]; } catch { continue; }
    if (typeof value === 'undefined') continue;
    put(k, value);
  }
  put('window', window);
  put('globalThis', globalThis);   // never the window's own
  // Whole-window listeners - `delivery.js` watches `visibilitychange`, `App.vue` watches
  // keys - are registered on the global, so they have to reach the window's own.
  put('addEventListener', window.addEventListener.bind(window));
  put('removeEventListener', window.removeEventListener.bind(window));
  put('dispatchEvent', window.dispatchEvent.bind(window));

  /* THE CONTENT FETCH, and nothing else. `content.js` reads static JSON off the origin -
   * the catalogue and one course - and under preview every other call goes to `previewApi`
   * without touching the network. Anything this does not know about THROWS rather than
   * returning an empty answer: a silent `{}` is how a test passes against a course that was
   * never loaded. */
  const routes = new Map();
  globalThis.fetch = async (input) => {
    const path = new URL(String(input), url).pathname;
    if (!routes.has(path)) throw new Error(`nothing is serving ${path}`);
    return {
      ok: true, status: 200,
      json: async () => structuredClone(routes.get(path)),
      text: async () => JSON.stringify(routes.get(path)),
    };
  };

  return {
    dom,
    window,
    /** Serve one JSON file at a path, as the content bucket would. */
    serve: (path, body) => routes.set(path, body),
    restore() {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
      dom.window.close();
    },
  };
}
