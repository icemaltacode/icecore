/* "I AM HERE" - the client half of the only thing that records somebody simply being signed
 * in, rather than doing something.
 *
 * EVERY OTHER SIGNAL ON THIS PLATFORM IS ABOUT AN ACTIVITY. A progress row says what was
 * solved, `LAST#` says where somebody got to, a connection row says who is in a lesson. "Is
 * this person logged in right now" is not one of those, and each attempt to derive it from
 * them answers a different question convincingly: a dot lit from `LAST#` claims somebody is
 * here who shut their laptop three minutes ago, and a dot lit from a live socket is dark all
 * day for everybody, because most of the day there is no lesson to be connected to. That was
 * the first version and it read as broken rather than as accurate.
 *
 * SO IT IS A HEARTBEAT, AND NOTHING ELSE IT COULD BE. Presence is the one fact that has to
 * be asserted continuously to stay true - a single stamp at sign-in would go on claiming
 * somebody is here for twelve hours.
 *
 * TWO MINUTES, WHICH IS THE ONLY NUMBER HERE WITH A COST. For a class of thirty that is
 * fifteen requests a minute, each a single PutItem - and the reader compares against a
 * five-minute window, so one missed beat does not blink anybody out of the room. Tighter
 * buys a dot that goes dark faster; nothing else.
 *
 * IT DOES NOT STOP WHEN THE TAB IS HIDDEN, and that is deliberate rather than an oversight.
 * A minimised window is somebody who is still signed in and still there, which is the
 * question being asked; browsers throttle background timers to about a minute anyway, so
 * this costs a hidden tab nothing extra. What DOES stop it is the machine sleeping or the
 * tab closing, which is exactly right - those are the cases where the answer is no.
 *
 * FAILURES ARE SWALLOWED, INCLUDING THE FIRST. Nothing on a student's screen depends on
 * this: a beat that does not land makes a dot in somebody else's admin panel wrong for two
 * minutes, and an error surfaced here would interrupt a lesson to report it. It is also the
 * one call in the app whose failure a student can do nothing whatever about.
 */
import { api, session } from './auth.js';

const BEAT = 2 * 60 * 1000;

let timer = null;

/* Awaited by nobody. `api` retries once through a token refresh on a 401, which is the only
 * failure worth doing anything about, and everything past that is noise on this call. */
const beat = () => { api('account/here', { method: 'POST' }).catch(() => {}); };

/**
 * Start saying so, and keep saying it. Idempotent: called again it leaves the beat already
 * running rather than starting a second one, because two timers is two requests a beat for
 * one person and nothing at all to show for it.
 */
export function startPresence() {
  if (timer || !session.sub) return;
  beat();
  timer = setInterval(beat, BEAT);
}

/** Stop, on sign-out. A tab that has signed out is not somebody who is here. */
export function stopPresence() {
  clearInterval(timer);
  timer = null;
}
