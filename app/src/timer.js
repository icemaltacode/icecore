/* THE CLOCK ON THE WALL: an educator gives the room five minutes, and every screen counts
 * them down together.
 *
 * A FIFTH FILE rather than more of delivery.js, for the reason board.js is a fourth and
 * chat.js a third. That one is the SESSION - who is delivering, to whom, and where they
 * are. This is a surface the session neither owns nor outlives: a timer can be set, paused
 * and taken away without anything about the lesson changing, and most lessons never have
 * one in them at all.
 *
 * A DEADLINE, NEVER A TICK. What crosses the channel is the INSTANT the time runs out, and
 * this file subtracts a local now from it. So nothing counts down on the wire, nothing is
 * pushed once a second to a dozen sockets, and zero arrives on every screen by arithmetic
 * rather than by a message - which is also why nothing has to be delivered at the moment it
 * happens, the one moment a dropped message would be most obvious. Presence already works
 * this way: the server holds the fact and the client computes the reading.
 *
 * AND THE CLOCK IT WAS MEASURED AGAINST TRAVELS WITH IT. An instant is worth nothing on its
 * own: a laptop in a classroom can be minutes out, and a countdown reading 4:37 at the front
 * and 1:12 on one desk is worse than no countdown, because both look equally true. Every
 * message carries the server's `now`, and `applyTimer` corrects for the difference ONCE, on
 * arrival - so `timer.ends` is already in this browser's own clock and nothing downstream
 * ever has to know that any of this was a problem.
 *
 * NOTHING HERE DECIDES ANYTHING. The timer is a fact about the LESSON, so every change
 * arrives as a message, the educator's own presses included: their buttons send, and the
 * clock moves when the answer comes back. That is `sync`'s rule and board.js's - a timer
 * that said it was paused when the write had been refused is worse than one that lags.
 */
import { reactive, computed, ref, watch } from 'vue';
import { on, send, emitLocal } from './live.js';
import { previewRole } from './preview.js';
import { delivery } from './delivery.js';

/** What the educator is offered, in minutes. Long enough to cover an exercise, short enough
 *  that the list is read rather than scanned. Anything else is what Reset and a second press
 *  are for. */
export const DURATIONS = [1, 2, 5, 10, 15, 20, 30];

export const timer = reactive({
  /** Is there a timer in this lesson at all. */
  on: false,
  /** Is it counting. Paused is still a timer; it is just not moving. */
  running: false,
  /** Large, at the bottom of every screen, rather than small beside the band. */
  prominent: false,
  /** What it was set to, in seconds - so Reset can ask for the same again. */
  seconds: 0,
  /** When it runs out, in milliseconds and IN THIS BROWSER'S CLOCK. Meaningless while paused. */
  ends: 0,
  /** What is left, in milliseconds, while paused. Meaningless while running. */
  left: 0,
});

/* The one ticking value in the app, and it exists only while something is actually counting.
 * A computed reading `Date.now()` directly would never invalidate - Vue has no way to know
 * the clock moved - so the clock has to be a ref that something writes to.
 *
 * FOUR TIMES A SECOND, NOT ONCE. A one-second interval drifts against the second it is
 * displaying, so the same number is shown for nearly two seconds and then one is skipped -
 * which is exactly the thing a room full of people watching a countdown notices. Nothing
 * re-renders in between: the text only changes when the formatted string does. */
const now = ref(Date.now());
let ticking = null;
watch(() => timer.on && timer.running, live => {
  clearInterval(ticking);
  ticking = null;
  if (!live) return;
  now.value = Date.now();
  ticking = setInterval(() => { now.value = Date.now(); }, 250);
}, { immediate: true });

/** Milliseconds left, never below zero: a countdown that has run out sits at zero and says
 *  so, rather than counting up into a negative number nobody asked for. */
export const remaining = computed(() =>
  Math.max(0, timer.running ? timer.ends - now.value : timer.left));

/** Whether the time has run out. Only meaningful when there is a timer to have run out. */
export const done = computed(() => timer.on && remaining.value <= 0);

/** The last minute, which is when a countdown stops being information and starts being a
 *  prompt. A proportion would make a one-minute timer urgent from the moment it started. */
export const urgent = computed(() => timer.on && !done.value && remaining.value <= 60 * 1000);

/* m:ss under an hour, h:mm:ss over it - the band's elapsed clock's rule, and the same
 * function would do for both if they did not round in opposite directions. This one rounds
 * UP: a timer showing 0:00 for the last nine tenths of a second has already said the thing
 * it is there to say, and says it wrongly. */
export function clock(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const two = n => String(n).padStart(2, '0');
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
    : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** What every screen shows: `4:37`, or `0:00` once it has run out. */
export const label = computed(() => clock(remaining.value));

/* ------------------------------------------------------------------ applied from the wire */

/**
 * The timer as the server sees it, put into this browser's terms.
 *
 * `now` is the server's clock at the moment it sent this, and the correction is the whole
 * job: `ends` arrives measured against that clock and is stored measured against ours, so
 * every reader below is a plain subtraction from `Date.now()`.
 */
function applyTimer(t) {
  if (!t) {
    timer.on = false; timer.running = false; timer.prominent = false;
    timer.seconds = 0; timer.ends = 0; timer.left = 0;
    return;
  }
  /* Positive when the server's clock is ahead of ours. Taken from this message rather than
   * kept as a running estimate: a stored skew is a fourth thing that can be stale, and there
   * is a fresh reading on every message that could possibly matter. */
  const skew = (Date.parse(t.now) || Date.now()) - Date.now();
  timer.seconds = Math.max(0, Number(t.seconds) || 0);
  timer.prominent = !!t.prominent;
  timer.running = !!t.running;
  timer.ends = t.ends ? Date.parse(t.ends) - skew : 0;
  timer.left = Math.max(0, Number(t.left) || 0) * 1000;
  timer.on = true;
  /* So the first frame is right. Without it the clock reads up to a quarter of a second
   * stale at the moment it appears, which on a fresh five-minute timer is a screen that
   * opens on 4:59. */
  now.value = Date.now();
}

on('timing', m => applyTimer(m.timer || null));

/* Off the roster too, like control, the editor switch and the board: a client that has just
 * connected, or just come back from a tunnel, would otherwise sit under a clock that stopped
 * when its socket did - and a student who joins eight minutes into a ten-minute exercise
 * would never learn there was one.
 *
 * Only when the roster says something about it. Absent from an older deployment and null
 * from a lesson with no timer, and reading the first as the second would take a live
 * countdown off every screen each time anything reconnected. */
on('roster', m => { if ('timer' in m) applyTimer(m.timer || null); });

/* A different session is a different lesson, and nobody carries a deadline into one. Watched
 * rather than told, so that delivery.js goes on having no idea this file exists - chat.js's
 * rule and board.js's. */
watch(() => delivery.cohort, () => applyTimer(null));

/* ------------------------------------------------------- the educator's gestures

   Each one is a send and nothing more. THE ARITHMETIC IS THE SERVER'S - what pausing leaves
   behind, what resuming starts from - because two clients doing that sum are two clocks that
   can disagree about it. What is below is the preview restating those rules, which is what
   `preview.js` already is for every other route in the app: there is no socket under
   `icecore dev`, and a control that silently does nothing is worse than one that is not
   there. See the Lambda's `timer` case for the version that counts. */
const echo = t => { if (previewRole()) emitLocal({ type: 'timing', timer: t }); };
const iso = ms => new Date(ms).toISOString();
const asSent = () => ({ seconds: timer.seconds, prominent: timer.prominent,
                        now: iso(Date.now()) });

/** Set a countdown going - and, with the duration it already has, reset it. */
export function setTimer(seconds, prominent = timer.prominent) {
  const s = Math.max(1, Math.round(seconds));
  if (send('timer', { do: 'set', seconds: s, prominent: !!prominent })) return;
  echo({ seconds: s, ends: iso(Date.now() + s * 1000), running: true,
         prominent: !!prominent, now: iso(Date.now()) });
}

export function pauseTimer() {
  if (!timer.on || !timer.running) return;
  if (send('timer', { do: 'pause' })) return;
  echo({ ...asSent(), running: false, left: Math.round(remaining.value / 1000) });
}

export function resumeTimer() {
  if (!timer.on || timer.running) return;
  if (send('timer', { do: 'resume' })) return;
  echo({ ...asSent(), running: true, ends: iso(Date.now() + timer.left) });
}

/** Large at the bottom of every screen, or small beside the band. Never a restart. */
export function showTimer(prominent) {
  if (!timer.on) return;
  if (send('timer', { do: 'show', prominent: !!prominent })) return;
  echo({ ...asSent(), prominent: !!prominent,
         ...(timer.running ? { running: true, ends: iso(timer.ends) }
                           : { running: false, left: Math.round(timer.left / 1000) }) });
}

/** Take it away. There is no timer in this lesson again. */
export function clearTimer() {
  if (send('timer', { do: 'clear' })) return;
  echo(null);
}
