/* The room's chat: what is said during a lesson, and only during it.
 *
 * A THIRD FILE rather than more of delivery.js, for the reason that one is not more of
 * live.js. That one is the CHANNEL - a socket that knows nothing about what travels on it -
 * and delivery.js is the SESSION: who is delivering, to whom, and where they are. This is a
 * conversation, which outlives neither and is owned by neither: the panel that draws it can
 * be closed, popped out or never opened at all, and none of that is the session's business.
 *
 * NOTHING HERE IS DURABLE, and that is a decision rather than a shortcut. Messages ride the
 * channel and are held on the session row - the last two hundred, so somebody who joins ten
 * minutes in can read what they walked in on - and they go when that row goes. Chat is
 * personal data; `forget()` in the account function deletes everything under a student's
 * partition and the Article 15 export has to be able to produce everything the platform
 * holds about them, and text on a COHORT partition is reachable by neither. Making it
 * transient removes that problem instead of handling it. See LIVE.md.
 *
 * THE SERVER ASSIGNS THE ID AND THE TIME, and everyone - the sender included - draws the
 * list the server sent. An optimistic local echo would give the person who typed a message
 * a slightly different transcript from everybody else's, which is the one thing a
 * transcript must not be. The cost is a round trip before your own words appear, on a
 * socket that is already open.
 */
import { reactive, watch } from 'vue';
import { session } from './auth.js';
import { previewRole } from './preview.js';
import { on, send, emitLocal } from './live.js';
import { delivery } from './delivery.js';

/** Mirrors CHAT_CHARS in the Lambda: a chat line, not an essay. */
export const LIMIT = 500;
/** Mirrors CHAT_KEEP. Trimmed on this side too, so a long lesson is not an ever-growing list. */
const KEEP = 200;

const POP_KEY = 'ice-live-chat-popped';

/* How long a popup stays. Long enough to read a sentence and decide, short enough that three
 * in a row do not queue up over the exercise somebody is working on. */
const TOAST_MS = 7000;

export const chat = reactive({
  /** Oldest first, which is the order a transcript is read in. */
  messages: [],
  /** How many have arrived since anything last drew them. Zero while something is. */
  unread: 0,
  /* THE MOST RECENT MESSAGE NOBODY HAS SEEN, or null. A badge on a collapsed rail says that
   * something was said; it does not say WHAT, and a student mid-exercise will not open a
   * panel to find out. Being spoken to during a lesson is the one thing on this screen that
   * might need answering, so it gets a sentence rather than a number.
   *
   * ONE AT A TIME, replaced rather than queued: three popups stacked over an exercise is a
   * thing to dismiss rather than a thing to read, and the older ones are in the log anyway. */
  toast: null,
  /* Bumped when something asks for the chat to be shown. The panel owns whether it is open
   * and reads this; a counter rather than a boolean, because asking twice in a row has to
   * work and a flag would need resetting by whoever consumed it. */
  reveal: 0,
  /* Docked in the participants panel, or floating over the player. Remembered per browser
   * like the panel's own collapse: it says something about how somebody wants to work, and
   * a window that returns to the dock every lesson reads as refusing to stay put. */
  popped: localStorage.getItem(POP_KEY) === 'yes',
});

export const pop = (yes = !chat.popped) => {
  chat.popped = yes;
  localStorage.setItem(POP_KEY, yes ? 'yes' : 'no');
};

/** Ours, so it can be drawn on the other side and never counted as unread. */
export const mine = m => !!m?.sub && m.sub === session.sub;

/* How many panes are currently showing the log. A COUNT rather than a flag because the
 * docked pane and the popped one can overlap for a tick while one replaces the other, and a
 * flag cleared by the unmounting half would leave the badge counting messages that are on
 * screen. */
let readers = 0;

/** Called by whatever draws the log, on mount and on unmount. */
export function reading(yes) {
  readers = Math.max(0, readers + (yes ? 1 : -1));
  if (readers > 0) chat.unread = 0;
}

/* Union by id rather than replacement. A `history` answer and a `said` that arrived while it
 * was in flight are both true, and taking the reply wholesale would drop the newer one -
 * rarely, silently, and exactly when somebody had just reconnected. */
function merge(incoming) {
  const byId = new Map(chat.messages.map(m => [m.id, m]));
  for (const m of incoming || []) if (m?.id) byId.set(m.id, m);
  chat.messages = [...byId.values()]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(-KEEP);
}

let toastTimer;

on('said', m => {
  merge([m]);
  /* Not our own, and not while something is already showing the log - a popup for a message
   * you can already see is a popup that trains people to dismiss them. */
  if (readers > 0 || mine(m)) { chat.unread = 0; return; }
  chat.unread += 1;
  chat.toast = m;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { chat.toast = null; }, TOAST_MS);
});

/** Put it away without reading the rest. */
export function hideToast() {
  clearTimeout(toastTimer);
  chat.toast = null;
}

/**
 * Show the chat, wherever it happens to live.
 *
 * The panel opens ITSELF, by watching `reveal`. Reaching in and setting its localStorage key
 * from here would be a second writer for a preference that component owns, and the two would
 * disagree the first time either changed.
 */
export function revealChat() {
  hideToast();
  chat.unread = 0;
  if (!chat.popped) chat.reveal += 1;
}

on('history', m => merge(m.messages));

/* Asked the moment there is a socket to ask on, and again after every reconnection - for
 * the same reason delivery.js asks for the roster there: everything said during the gap was
 * said to a client that was not listening. */
on('open', () => send('history'));

/* A different session is a different conversation. Watching the session rather than being
 * told by it keeps the dependency one-way: delivery.js has no business knowing chat exists,
 * and a `clearChat()` call inside `forget()` would be the import that closes the loop. */
watch(() => delivery.cohort, () => {
  chat.messages = []; chat.unread = 0;
  hideToast();
});

/**
 * Say something to the room. Returns false when there was nothing to say or nowhere to say
 * it, which is what a composer needs to know and the whole of what it needs to know.
 *
 * WHERE IT WAS SENT FROM IS NOT PASSED. The connection row already carries this client's
 * position, reported on every move, so the Lambda stamps it on - and one fact reported once
 * cannot disagree with itself.
 */
export function say(text) {
  const t = String(text || '').trim().slice(0, LIMIT);
  if (!t) return false;
  if (send('say', { text: t })) return true;

  /* No socket in preview, so `--as admin` would have a composer that swallows everything -
   * and a control that silently does nothing is worse than one that is not there. The echo
   * is local and carries no `where`, which is the one part of the feature preview cannot
   * reach for your OWN messages; the scripted room sends incoming ones that do. */
  if (previewRole()) {
    emitLocal({
      type: 'said',
      id: `local-${Date.now()}`,
      sub: session.sub, from: session.name || 'You',
      role: session.admin ? 'tutor' : 'student',
      text: t, at: new Date().toISOString(), where: null,
    });
    return true;
  }
  return false;
}
