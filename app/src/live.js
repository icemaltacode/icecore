/* The client half of the live channel: one socket, kept open.
 *
 * A thin module on purpose. It knows how to get a socket and keep one, and nothing about
 * what travels on it - positions, presence, chat and remote control are all `on('type')`
 * handlers registered by whatever owns them. The one rule it enforces is that there is
 * exactly ONE socket per tab, because two would each deliver every message and every
 * listener would fire twice.
 *
 * A TICKET IS SINGLE-USE, so every connection attempt mints a fresh one. That is not an
 * inefficiency to optimise away later: it is what makes a stolen ticket worth nothing, and
 * it is why `open()` is async and why reconnecting is a call to the API rather than a
 * retry of the same URL. See infra/lambda/live/index.mjs.
 *
 * RECONNECTING IS THE NORMAL CASE, not the failure case. API Gateway closes an idle socket
 * after ten minutes and ANY socket after two hours, whatever is happening on it - so a
 * lesson that runs past two hours will be disconnected mid-sentence unless something
 * reopens it. The heartbeat handles the first and the backoff handles the second, and
 * neither is visible to anything above this file.
 *
 * A SOCKET CAN DIE WITHOUT SAYING SO, and that is the failure a backoff cannot see. A lid
 * closed, a wifi handover, a NAT that forgot the flow: the TCP connection is gone and no FIN
 * ever arrives, so `readyState` stays OPEN, `onclose` never fires, `send` succeeds into
 * nothing and the reconnect this file is built around is never triggered at all. The room
 * simply goes quiet, indefinitely, and the only thing that fixes it is the student reloading
 * the page - which is precisely what was reported after the first ONEY lesson.
 *
 * So the heartbeat is a QUESTION rather than a keep-alive: the server answers every `ping`
 * with a `pong` (see the live Lambda), and a socket that has said nothing at all for long
 * enough is declared dead and replaced. Anything inbound counts, not only the pong - a
 * lesson in full flow proves its own connection.
 *
 * `status` is reactive because a band on screen has to be able to say the room has gone
 * quiet. It is deliberately not an error: a socket reconnecting is ordinary, and a student
 * shown a red message every time a train enters a tunnel learns to ignore the one that
 * matters. `lost` is the field that separates the two cases a band has to tell apart -
 * opening for the first time, and having been connected and dropped.
 */
import { reactive } from 'vue';
import { api, socketUrl } from './auth.js';

/**
 * 'closed' | 'opening' | 'open' | 'waiting' - `waiting` is between attempts.
 *
 * `lost` is true from the moment a socket that HAD been open goes away until the next one
 * opens. Not derivable from `status`: the first connection of a session and a reconnection
 * after twenty minutes in a tunnel are both 'opening', and only one of them is something a
 * student needs to be told about. Cleared on open and on close, so it never outlives the
 * session it describes.
 */
export const live = reactive({ status: 'closed', cohort: null, since: null, lost: false });

let socket = null;
let heart = null;
let retry = null;
let attempt = 0;
/* When something last arrived on the socket. Any message, not only a pong - see `beat`. */
let heard = 0;
/* Set by close() and checked after every await, so a socket that is opening when somebody
 * closes the channel does not install itself afterwards. Without it, leaving a session and
 * rejoining races: the abandoned attempt lands second and becomes the live socket. */
let generation = 0;

const listeners = new Map();

/* Ten minutes is API Gateway's idle timeout, so anything under it keeps the socket. This was
 * four minutes, which is right for a keep-alive and far too slow for a liveness check: a
 * half-open socket would go unnoticed for the better part of a quarter of an hour. Thirty
 * seconds is two messages a minute per client - for a class of thirty, one invocation a
 * second against a route that already carries fifteen pointer frames a second from one. */
const HEARTBEAT = 30 * 1000;
/* Three missed answers. Two would fire on one slow round trip over a phone tethering, and
 * declaring a working socket dead costs a reconnection nobody asked for; four is a minute
 * and a half of a lesson happening to somebody who cannot hear it. */
const SILENT = 3 * HEARTBEAT + 5000;
/* Backoff, capped. The cap matters more than the curve: the two-hour disconnect arrives
 * mid-lesson, and a client that has backed off to five minutes by then is a student who
 * misses the rest of it. */
const WAIT = [500, 1000, 2000, 5000, 10000, 15000];
const waitFor = n => WAIT[Math.min(n, WAIT.length - 1)];

/**
 * Listen for one message type. Returns a function that stops listening.
 *
 * Handlers are held per type rather than one dispatcher, so a component can take down
 * exactly its own without knowing who else is listening.
 */
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

/**
 * Send a message. Silently drops when there is no socket - which is the honest behaviour
 * for a channel: everything that travels on it is a moment, and a moment that could not be
 * delivered has passed. Anything that must survive a reconnection is a row, not a message.
 */
export function send(type, data = {}) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type, ...data }));
  return true;
}

function deliver(msg) {
  for (const fn of listeners.get(msg.type) || []) {
    // One listener throwing must not stop the others hearing it.
    try { fn(msg); } catch (e) { console.error('live listener failed', msg.type, e); }
  }
}

const received = raw => { try { deliver(JSON.parse(raw)); } catch { /* not JSON */ } };

/**
 * Deliver a message as though it had arrived on the socket.
 *
 * THE PREVIEW'S ONE DOOR IN, and it is this one rather than a dispatcher of its own so that
 * what a scripted room exercises is the real listener registry - every handler that a real
 * message would reach, in the same order, including ones registered by components that had
 * not been written when the script was. A second dispatcher only ever knows about the
 * handlers somebody remembered to add to it.
 */
export const emitLocal = deliver;

async function attach(cohort, mine) {
  const url = socketUrl();
  if (!url) return;
  live.status = 'opening';

  let ticket;
  try {
    ({ ticket } = await api('live/ticket', { method: 'POST', body: { cohort } }));
  } catch (e) {
    if (mine !== generation) return;
    console.warn('live: could not get a ticket', e.message);
    return schedule(cohort, mine);
  }
  if (mine !== generation) return;

  const ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
  socket = ws;

  ws.onopen = () => {
    if (mine !== generation) return ws.close();
    attempt = 0;
    live.status = 'open';
    live.lost = false;
    live.since = live.since || new Date().toISOString();
    heard = Date.now();
    heart = setInterval(() => beat(cohort, mine), HEARTBEAT);
    /* A LOCAL MESSAGE, delivered through the same path as a real one, so that anything
     * which has to re-ask for state on connecting can listen for it exactly as it listens
     * for everything else. This file still knows nothing about what that state is.
     *
     * It fires on every RE-connection too, which is the point: after a tunnel or after API
     * Gateway's two-hour cap, whatever this client knew is as old as the gap. */
    deliver({ type: 'open' });
  };
  ws.onmessage = e => {
    if (mine !== generation) return;
    /* ANY inbound traffic, before it is even parsed. A pong proves the socket; so does a
     * slide, a chat line and a pointer frame, and a busy lesson should not also have to
     * answer a question every thirty seconds to be believed. */
    heard = Date.now();
    received(e.data);
  };
  ws.onerror = () => { /* onclose always follows; reconnecting is handled there once. */ };
  ws.onclose = () => {
    clearInterval(heart); heart = null;
    if (mine !== generation) return;
    socket = null;
    live.lost = true;
    schedule(cohort, mine);
  };
}

/**
 * Ask, and check the last answer arrived.
 *
 * The order matters: a socket is judged on the silence BEFORE this ping, not after it, so a
 * connection has three whole intervals to say something. `close()` on a half-open socket
 * usually fires `onclose` locally straight away, which is what schedules the reconnection -
 * but a browser is not obliged to, so the reconnection is scheduled here rather than left to
 * an event that may never come. `onclose` arriving afterwards is harmless: it bumps nothing
 * and `schedule` clears its own timer.
 */
function beat(cohort, mine) {
  if (mine !== generation) return;
  if (Date.now() - heard > SILENT) {
    console.warn('live: nothing heard for', Math.round((Date.now() - heard) / 1000), 's - reconnecting');
    clearInterval(heart); heart = null;
    const dead = socket;
    socket = null;
    if (dead) { dead.onclose = null; try { dead.close(); } catch { /* already gone */ } }
    live.lost = true;
    return schedule(cohort, mine);
  }
  send('ping');
}

function schedule(cohort, mine) {
  live.status = 'waiting';
  clearTimeout(retry);
  retry = setTimeout(() => { if (mine === generation) attach(cohort, mine); }, waitFor(attempt++));
}

/* ---- the two moments worth not waiting out --------------------------------
 *
 * The backoff caps at fifteen seconds, which is the right answer when there is no
 * information. These are the two times there IS some: the network came back, and the person
 * came back. Waiting out a timer in either case is a student looking at a reconnecting
 * banner on a working connection, which reads as the platform being broken.
 *
 * The attempt counter is reset too, not only the timer - otherwise a laptop that spent an
 * hour asleep wakes up already backed off to the cap.
 *
 * Registered once, at module load, and never removed: this module is a singleton and the
 * handlers do nothing at all unless there is a channel open. Cheaper than a pair of
 * add/remove calls that have to stay balanced across every open and close.
 */
function nudge() {
  if (!live.cohort) return;
  if (live.status === 'waiting') {
    clearTimeout(retry);
    attempt = 0;
    retry = setTimeout(() => attach(live.cohort, generation), 0);
    return;
  }
  /* AND THE OTHER HALF, which is the one that actually matters on a laptop lid: the socket
   * survived being suspended in name only. Timers do not run while a machine is asleep, so
   * the heartbeat has not had a chance to notice - ask it now, on the wake, rather than up
   * to thirty seconds later. */
  if (live.status === 'open') beat(live.cohort, generation);
}

if (typeof addEventListener === 'function') {
  addEventListener('online', nudge);
  addEventListener('visibilitychange', () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') nudge();
  });
}

/**
 * Join a cohort's channel. Idempotent for the same cohort, so a component remounting does
 * not tear down a working socket; a different cohort closes the old one first.
 */
export function open(cohort) {
  if (!socketUrl() || !cohort) return;
  if (live.cohort === cohort && socket) return;
  close();
  generation += 1;
  live.cohort = cohort;
  live.since = null;
  live.lost = false;
  attempt = 0;
  attach(cohort, generation);
}

/**
 * PREVIEW ONLY: pretend the connection went away, and came back.
 *
 * There is no socket under `icecore dev` - `socketUrl()` is null with no auth.json - so the
 * yellow band, which is the whole of what a disconnected student is told, is otherwise a
 * screen nobody can look at before it is shipped. Same rule the sign-in refusals and the
 * admin panel's disabled controls already follow.
 *
 * It moves the two fields a band reads and touches nothing else: there is no socket to close
 * and no ticket to mint, so a scripted drop cannot leave a real channel in a state it could
 * not otherwise reach.
 *
 * IT CANNOT GUARD ON `live.cohort`, which is the obvious check and the reason the first
 * version of this did nothing at all. `open()` returns before it sets that field when there
 * is no `socketUrl()` - which is the whole of preview - so in the one place this function
 * runs, the guard is false. Whether there is a session to be dropped from is the caller's
 * question anyway: the room script only runs inside one.
 */
export function simulateLoss(ms = 7000) {
  live.lost = true;
  live.status = 'waiting';
  setTimeout(() => {
    live.lost = false;
    /* Back to what preview is the rest of the time. A real reconnection would land on
     * 'open'; claiming that here would be the one field of this stand-in that lied. */
    live.status = socketUrl() ? 'open' : 'closed';
    deliver({ type: 'open' });
  }, ms);
}

/** Leave. Bumping the generation is what abandons any attempt already in flight. */
export function close() {
  generation += 1;
  clearTimeout(retry); retry = null;
  clearInterval(heart); heart = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  live.status = 'closed';
  live.cohort = null;
  live.since = null;
  live.lost = false;
}
