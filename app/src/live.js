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
 * `status` is reactive because a band on screen has to be able to say the room has gone
 * quiet. It is deliberately not an error: a socket reconnecting is ordinary, and a student
 * shown a red message every time a train enters a tunnel learns to ignore the one that
 * matters.
 */
import { reactive } from 'vue';
import { api, socketUrl } from './auth.js';

/** 'closed' | 'opening' | 'open' | 'waiting' - `waiting` is between attempts. */
export const live = reactive({ status: 'closed', cohort: null, since: null });

let socket = null;
let heart = null;
let retry = null;
let attempt = 0;
/* Set by close() and checked after every await, so a socket that is opening when somebody
 * closes the channel does not install itself afterwards. Without it, leaving a session and
 * rejoining races: the abandoned attempt lands second and becomes the live socket. */
let generation = 0;

const listeners = new Map();

/** Ten minutes is API Gateway's idle timeout; four is comfortably inside it. */
const HEARTBEAT = 4 * 60 * 1000;
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
    live.since = live.since || new Date().toISOString();
    heart = setInterval(() => send('ping'), HEARTBEAT);
    /* A LOCAL MESSAGE, delivered through the same path as a real one, so that anything
     * which has to re-ask for state on connecting can listen for it exactly as it listens
     * for everything else. This file still knows nothing about what that state is.
     *
     * It fires on every RE-connection too, which is the point: after a tunnel or after API
     * Gateway's two-hour cap, whatever this client knew is as old as the gap. */
    deliver({ type: 'open' });
  };
  ws.onmessage = e => { if (mine === generation) received(e.data); };
  ws.onerror = () => { /* onclose always follows; reconnecting is handled there once. */ };
  ws.onclose = () => {
    clearInterval(heart); heart = null;
    if (mine !== generation) return;
    socket = null;
    schedule(cohort, mine);
  };
}

function schedule(cohort, mine) {
  live.status = 'waiting';
  clearTimeout(retry);
  retry = setTimeout(() => { if (mine === generation) attach(cohort, mine); }, waitFor(attempt++));
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
  attempt = 0;
  attach(cohort, generation);
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
}
