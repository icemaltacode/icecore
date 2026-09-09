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
 * ONE MINUTE, WHICH IS THE ONLY NUMBER HERE WITH A COST. For a class of thirty that is
 * thirty requests a minute, each a single PutItem, and each beat is good for 150 seconds on
 * the other side - a missed beat and a half of slack, so a throttled background tab does not
 * blink anybody out of the room.
 *
 * AND A GOODBYE, because a window that closes should not have to be waited out. Without it
 * the shortest honest answer to "have they gone" is the length of the window, and somebody
 * who shut their laptop two minutes ago reads as present - which is the complaint that
 * brought this file its second version. The beat is a claim with an expiry ON IT, so leaving
 * is the same write with the expiry already past: no second route, no delete, and nothing a
 * client can do with it but stand itself down.
 *
 * `pagehide`, NOT `beforeunload`. That one does not fire on iOS at all and suppresses the
 * back-forward cache where it does; `pagehide` fires in both cases and tells them apart with
 * `persisted`. A page going INTO the cache is not somebody leaving - they may come straight
 * back with the timer still running - but it is also a page that has stopped beating, so it
 * is treated as a departure and `pageshow` starts the beat again.
 *
 * IT DOES NOT STOP WHEN THE TAB IS MERELY HIDDEN, and that is deliberate rather than an
 * oversight. A minimised window is somebody who is still signed in and still there, which is
 * the question being asked; browsers throttle background timers to about a minute anyway, so
 * this costs a hidden tab nothing extra. What stops it is the machine sleeping, which is
 * exactly right - the beats stop and the claim expires on its own.
 *
 * TWO TABS AND ONE OF THEM CLOSES is the case this gets briefly wrong: the goodbye stands
 * the person down while their other tab is still open, and the dot is dark until that tab's
 * next beat. Bounded by BEAT and therefore under a minute, and the alternative - tracking
 * sibling tabs through storage to decide who speaks last - is a great deal of machinery to
 * shave a wrong answer that corrects itself.
 *
 * FAILURES ARE SWALLOWED, INCLUDING THE FIRST. Nothing on a student's screen depends on
 * this: a beat that does not land makes a dot in somebody else's admin panel wrong for two
 * minutes, and an error surfaced here would interrupt a lesson to report it. It is also the
 * one call in the app whose failure a student can do nothing whatever about.
 */
import { api, session } from './auth.js';

const BEAT = 60 * 1000;

let timer = null;
let listening = false;

/* Awaited by nobody. `api` retries once through a token refresh on a 401, which is the only
 * failure worth doing anything about, and everything past that is noise on this call. */
const say = (gone, keepalive = false) => {
  api('account/here', { method: 'POST', body: { gone }, keepalive }).catch(() => {});
};

const beat = () => say(false);

/* Leaving. `keepalive` is what makes this leave the tab at all - see `api` - and the timer
 * is cleared first so a beat cannot race the goodbye and re-assert presence after it. */
const leave = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  if (session.sub) say(true, true);
};

/**
 * Start saying so, and keep saying it. Idempotent: called again it leaves the beat already
 * running rather than starting a second one, because two timers is two requests a beat for
 * one person and nothing at all to show for it.
 */
export function startPresence() {
  if (!session.sub) return;
  if (!listening) {
    listening = true;
    addEventListener('pagehide', leave);
    /* Coming BACK out of the back-forward cache, where nothing has been running. Guarded on
     * `persisted` so an ordinary first load does not start the beat twice - `startPresence`
     * is idempotent, but a listener that fires on every load is one more thing to reason
     * about than one that fires only when it has work. */
    addEventListener('pageshow', e => { if (e.persisted) startPresence(); });
  }
  if (timer) return;
  beat();
  timer = setInterval(beat, BEAT);
}

/** Stop, on sign-out. A tab that has signed out is not somebody who is here, and says so
 *  rather than fading out over the next two and a half minutes. */
export function stopPresence() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  say(true);
}
