/* A live delivery session: whether one is running, starting it, and ending it.
 *
 * Separate from `live.js` on purpose. That one is the CHANNEL - a socket, kept open, that
 * knows nothing about what travels on it. This one is the SESSION: rows, an HTTP API, and
 * the small amount of state a band at the top of the screen has to read. A session exists
 * whether or not anybody is connected to it, and a socket can be open before there is
 * anything to say on it, so folding them together would give each of them the other's
 * failure modes.
 *
 * ONLY ONE ADMIN MAY DELIVER TO A COHORT AT A TIME, and this file does not enforce that -
 * the conditional write in the Lambda does, because a check on this side is a race. What is
 * here is the reporting of the refusal: `start()` surfaces the 409 with the name of whoever
 * holds it, since the only useful thing about being refused is who to ask.
 *
 * WHY THE LIVE BUTTON IS OFF IS COMPUTED HERE, not in the component, for the reason
 * `walk.js` is not in `App.vue`: the cohort list and the live screen both have to agree
 * about whether a cohort can be delivered to, and two readings of that would disagree
 * exactly when it mattered.
 */
import { reactive } from 'vue';
import { api, session } from './auth.js';
import { previewRole, previewRoom, stopPreviewRoom, previewSummaryRows } from './preview.js';
import { open as openChannel, close as closeChannel, on, send, emitLocal } from './live.js';

/**
 * The session this tab is in, if any. `mine` is whether we are the one delivering: an admin
 * leading and a student following are in the same session and must not get the same
 * controls.
 */
export const delivery = reactive({
  cohort: null, title: '', course: null, by: null, name: '', at: null, mine: false,
  /* Whether this client's screen still moves with the tutor's.
   *
   * TRUE ON ARRIVAL AND FALSE THE MOMENT THEY MOVE THEMSELVES. Not a button they have to
   * find: a student who navigates has already decided to go somewhere, and a screen that
   * dragged them back would be the feature fighting them. The band then says so and offers
   * the way back, which is the only part of it that needs a control.
   *
   * Meaningless for the tutor, who is the thing being followed. */
  following: true,
});

/**
 * WHOSE SCREEN IS BEING DRIVEN, and by whom. Null everywhere when nobody's is.
 *
 * ONE OBJECT FOR THREE AUDIENCES, which is why it is a fact about the session rather than a
 * flag on a client. The admin driving reads it to know they still hold it; the student reads
 * it to be told, by name, and to be able to end it; everybody else reads it to know whether
 * the class is looking at a classmate's screen. A per-client flag would be three flags that
 * could disagree, and the disagreement would be a student who cannot see they are being
 * driven.
 *
 * `refused` is the one field that is local: a reason this client's own attempt was turned
 * down, cleared by whoever shows it.
 */
export const control = reactive({
  sub: null, name: '', by: null, byName: '', sharing: false, at: null, refused: '',
});

/**
 * Where this client has been told to go by whoever is driving it.
 *
 * `at` changes on every drive, including a drive back to somewhere it already is, so a
 * watcher fires on the INSTRUCTION rather than on the destination. Repeating one is a no-op
 * on screen, and the alternative - watching the position - silently drops the second of two
 * drives to the same row, which is exactly what paging back and forth in a deck looks like.
 */
export const driven = reactive({ position: null, code: null, cursor: null, at: null });

/**
 * WHAT THE STUDENT HAD WRITTEN when control began, as they sent it.
 *
 * The half of remote control that actually helps: an educator taking over somebody who is
 * stuck needs to see what they wrote, and the progress rows hold only the code that SOLVED an
 * exercise - a student in the middle of getting it wrong has nothing recorded anywhere. So it
 * comes off the channel or not at all.
 *
 * `when` changes on every arrival so a watcher fires on the message rather than the text,
 * which is the same reason `driven.at` exists.
 */
export const borrowed = reactive({ at: null, code: null, when: null });

/**
 * THE EDUCATOR'S EDITOR, ON THE WHOLE CLASS'S SCREENS.
 *
 * Remote control's other half: that one is a claim on one browser, addressed to one person,
 * and this is a demonstration - the educator writes and everybody following watches it being
 * written, caret and all. Sometimes the thing to teach is the answer.
 *
 * `on` IS A FACT ABOUT THE SESSION and the rest is the latest push. They arrive separately
 * because they change at different rates and mean different things: the switch is thrown
 * twice in an hour and rides the roster so a latecomer knows; the buffer arrives on every
 * keystroke and is a moment, gone if it was missed.
 *
 * `at` NAMES THE EXERCISE THE CODE BELONGS TO. A class does not move as one, so the other
 * side applies a push only where it belongs - dropping the educator's query into whatever a
 * student happens to have open is the difference between a demonstration and vandalism.
 *
 * `when` changes on every push so a watcher fires on the MESSAGE rather than the text, for
 * `driven.at`'s reason: typing a character back to what it was is still somebody typing.
 */
export const sync = reactive({ on: false, at: null, code: null, cursor: null, when: null });

/** Every session running right now, keyed by cohort - what the Live buttons read. */
export const live = reactive({ running: {}, loading: false });

/**
 * WHO IS IN THE ROOM. `members` is everyone the cohort holds, `here` is everyone connected,
 * keyed by sub.
 *
 * TWO LISTS, because they answer different questions and the difference is the feature: a
 * panel built from connections alone shows a class of twelve as a class of three and gives
 * a tutor no way to see who is missing. `members` comes from the cohort's rows and does not
 * change during a lesson; `here` changes constantly.
 *
 * KEYED BY PERSON, COUNTED BY CONNECTION. A student with two tabs is two sockets and one
 * person, so `conns` is a count and somebody is gone when it reaches nought - one `left`
 * treated as one departure would empty half the panel every time anybody closed a
 * duplicate tab.
 */
export const room = reactive({ members: [], here: {} });

/**
 * WHO ANSWERED WHAT, by exercise and then by sub.
 *
 * Accumulated on the CLIENT from the messages themselves, and stored nowhere. That is not
 * thrift: what a tutor wants here is the shape of one hour, and the platform already has the
 * durable half - a `PROG#` row for every success. What it deliberately does not have is a
 * record of failed attempts (see backlog.md), and this screen is the instrument for deciding
 * whether it ever should be. Writing one now would answer that question by assuming it.
 *
 * The connection row carries the LATEST mark, so a tutor who reloads mid-lesson gets back
 * whatever everybody currently connected last did, with the roster. What they do not get
 * back is the exercise before that one - which is the honest cost of not writing it down,
 * and worth knowing rather than papering over.
 *
 * KEYED BY STRING, always. An exercise id is a number and arrives from a socket as text, so
 * an unnormalised key is a lookup that never matches and a panel that stays empty for a
 * reason nobody can see. Same trap `progressId` exists for.
 */
export const marks = reactive({});
const markKey = at => (at == null ? '' : String(at));
/** Everyone's mark on one exercise: `{ [sub]: mark }`, empty when nobody has tried it. */
export const marksAt = exercise => marks[markKey(exercise)] || {};

const remember = (s, mine) => {
  delivery.following = true;
  delivery.cohort = s?.cohort || null;
  delivery.title = s?.title || '';
  delivery.course = s?.course || null;
  delivery.by = s?.by || null;
  delivery.name = s?.name || '';
  delivery.at = s?.at || null;
  delivery.mine = !!mine;
};

/** Forget the session and drop the socket. Called on End, on Leave, and on `ended`. */
/**
 * Forget the session and drop the socket. Called on End, on Leave, and on `ended`.
 *
 * IT NO LONGER FORGETS THAT THE SESSION IS RUNNING, and the difference is the whole of a bug:
 * leaving a lesson is a fact about this client and not about the lesson. Deleting the entry
 * here meant a student who left watched the invitation vanish and then reappear on the next
 * poll - the banner offering them the way back in blinking out of existence at the exact
 * moment it became useful. Ending a session removes it, and `ended` removes it, because those
 * are the two times it is actually gone.
 */
export function forget() {
  remember(null, false);
  room.members = []; room.here = {};
  for (const k of Object.keys(marks)) delete marks[k];
  setControl(null);
  driven.position = null; driven.code = null; driven.cursor = null; driven.at = null;
  borrowed.at = null; borrowed.code = null; borrowed.when = null;
  sync.on = false; sync.at = null; sync.code = null; sync.cursor = null; sync.when = null;
  stopPreviewRoom();
  stopReporting();
  closeChannel();
}

/* ---- telling the room you are still there ---------------------------------
 *
 * `ping` in live.js keeps the SOCKET open; this keeps the PERSON present. They are
 * deliberately different messages: if the keep-alive also counted as activity then nobody
 * would ever go idle, and a tab left open on a train would show as attentive for the whole
 * lesson.
 *
 * Throttled hard, and it can be: the server only needs to know somebody was active within
 * the last quarter of an hour. What it is NOT throttled against is a change of position -
 * that is the interesting event, and a move waited out for fifty seconds is a panel telling
 * a tutor where the class was a minute ago.
 */
const REPORT_EVERY = 60 * 1000;
const WATCHED = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
let lastReport = 0;
let lastAt = undefined;
let lastSlide = null;
let here = null;   // () => ({ at, title }) - where this client currently is

const report = (force = false) => {
  if (!delivery.cohort || !here) return;
  const at = here();
  const slide = at?.slide ?? null;
  /* A SLIDES STEP IS A RANGE, so paging inside one is a move even though the row has not
   * changed. This compared only the row, which made paging a deck both unreported AND
   * throttled to once a minute - the educator walked through nine slides and the class sat on
   * the first, which looks exactly like following being broken.
   *
   * The socket half was right all along and so was the test, because the test sends `active`
   * itself. Nothing exercised the client's own reporting, which is where the slide was being
   * dropped. */
  const moved = at?.at !== lastAt || slide !== lastSlide;
  if (!force && !moved && Date.now() - lastReport < REPORT_EVERY) return;
  lastReport = Date.now();
  lastAt = at?.at;
  lastSlide = slide;
  send('active', { at: at?.at ?? null, title: at?.title || '', slide });
};

const onActivity = () => report();

/**
 * Start reporting activity, given a way to ask where this client is.
 *
 * The position is a callback rather than a value because it changes constantly and this
 * module has no business watching the player's state - App.vue knows where it is, and
 * asking is cheaper than being told.
 */
export function reportActivity(whereAmI) {
  here = whereAmI;
  lastReport = 0; lastAt = undefined; lastSlide = null;
  for (const e of WATCHED) addEventListener(e, onActivity, { passive: true });
  report(true);
}

export function stopReporting() {
  for (const e of WATCHED) removeEventListener(e, onActivity);
  here = null;
}

/** Say where we are now, whatever the throttle says. Called when the player moves. */
export const reportPosition = () => report();

/**
 * Somebody pressed Check. Every press, whichever way it went.
 *
 * NOT THROTTLED, unlike activity: a verdict is the event, not a heartbeat, and a tutor
 * watching a class work through a question needs the answers as they land rather than a
 * minute later. There are at most a dozen of them a minute in a class of twelve.
 *
 * Sent by the tutor's own client too, and dropped on the other side - they are not in
 * `members`, so nothing draws it. One less branch here than a rule about who may report.
 */
export function reportMark(v) {
  if (!delivery.cohort || v?.at == null) return;
  send('marked', {
    at: v.at,
    step: v.step ?? null,
    choice: v.choice ?? null,
    pass: !!v.pass,
    error: !!v.error,
  });
}

/* Somebody else ended it. The band has to go on its own rather than waiting for the next
 * navigation, or a student sits in a room that is not there any more. Registered once, at
 * module load: the listener outlives any component that shows the band. */
on('ended', () => {
  // Read before `forget` clears it: this is one of the two times the session really is gone.
  if (delivery.cohort) delete live.running[delivery.cohort];
  forget();
});

/* ---- the room -------------------------------------------------------------
 *
 * Registered at module load rather than by the panel, deliberately: the band counts how
 * many are here and the panel may never be opened at all, so a roster that only arrived
 * while a component was mounted would leave the count blank on the screen that shows it. */
function setControl(c) {
  /* BEING RELEASED PUTS YOU BACK WITH THE CLASS.
   *
   * Without this the band came back saying "you have stopped following and are working on
   * your own" the moment an educator let go - which the student had not done and could not
   * have: they were being driven. `following` is the flag for a decision somebody took, and
   * nothing about being controlled is their decision.
   *
   * It also restores the state the lesson needs: an educator who steered somebody to an
   * exercise and let go expects the next thing they show the class to reach them too. It
   * does not MOVE them - the follow watcher only fires when the educator next goes
   * somewhere - so nobody is yanked off the thing they were just helped with. */
  if (control.sub && control.sub === session.sub && !c) delivery.following = true;

  control.sub = c?.sub || null;
  control.name = c?.name || '';
  control.by = c?.by || null;
  control.byName = c?.byName || '';
  control.sharing = !!c?.sharing;
  control.at = c?.at || null;
  control.refused = '';
}

const HANDLERS = {
  roster(m) {
    room.members = m.members || [];
    room.here = {};
    for (const c of m.here || []) { add(c); record(c.sub, c.mark); }
    /* Only when the roster says something about it. `control` is absent from a roster sent
     * by an older deployment and null from one where nobody is being driven, and the two
     * must not be the same thing here - clearing on absence would drop a live control every
     * time a client reconnected. */
    if ('control' in m) setControl(m.control);
    // Same rule for the same reason: absent from an older deployment, false from a room
    // where nothing is being shown, and the two must not be one thing here.
    if ('sync' in m) sync.on = !!m.sync;
  },
  joined(m) { add(m.who); },
  /* MERGED, never replaced. A roster answers "what is everybody doing now" and carries one
   * mark each; the accumulated picture is older than that and still true. Replacing would
   * empty the results view every time a client reconnected. */
  marked(m) { record(m.sub, m.mark); },
  left(m) {
    const p = room.here[m.sub];
    if (!p) return;
    if (--p.conns <= 0) delete room.here[m.sub];
  },
  moved(m) {
    const p = room.here[m.sub];
    if (p) { p.position = m.position; p.seen = m.at; }
  },
  controlling(m) { setControl(m.control); },
  /* The switch. Cleared of its buffer on the way down so that turning it on again cannot
   * momentarily show the last thing the educator wrote half an hour ago. */
  syncing(m) {
    sync.on = !!m.on;
    if (!m.on) { sync.at = null; sync.code = null; sync.cursor = null; }
  },
  synced(m) {
    sync.at = m.at ?? null;
    sync.code = typeof m.code === 'string' ? m.code : null;
    sync.cursor = m.cursor ?? null;
    sync.when = m.when || new Date().toISOString();
  },
  driven(m) {
    driven.position = m.position;
    /* Undefined means "not sent", which is not the same as an empty editor - see `drive`. */
    if (m.code !== undefined) driven.code = m.code;
    if (m.cursor !== undefined) driven.cursor = m.cursor;
    driven.at = m.at || new Date().toISOString();
  },
  /* What the student had written when we took over. Only a controller ever receives one. */
  buffer(m) { borrowed.at = m.at; borrowed.code = m.code; borrowed.when = new Date().toISOString(); },
  /* A refusal is addressed to this client alone and always names a reason, because the two
   * that exist - somebody else already has them, and they are not connected - are both
   * things the admin can do something about and neither is guessable from a button that
   * did nothing. */
  refused(m) { if (m.what === 'control') control.refused = m.why || 'That could not be done.'; },
};
for (const [type, fn] of Object.entries(HANDLERS)) on(type, fn);

/* Ask for the roster the moment there is a socket to ask on - and again after every
 * reconnection, because everything that happened during the gap happened to a client that
 * was not listening. The server cannot push it from `$connect`: the connection does not
 * exist until that handler returns, so a post from inside it is a GoneException. */
on('open', () => send('roster'));

function record(sub, mark) {
  if (!sub || mark?.exercise == null) return;
  const at = markKey(mark.exercise);
  // A fresh object per exercise, or Vue never sees the first mark on one arrive.
  marks[at] = { ...(marks[at] || {}), [sub]: mark };
}

function add(who) {
  if (!who?.sub) return;
  const had = room.here[who.sub];
  room.here[who.sub] = {
    sub: who.sub,
    name: who.name || had?.name || '',
    role: who.role || had?.role || 'student',
    // A second tab must not reset where the first one said the person was.
    position: who.position ?? had?.position ?? null,
    seen: who.seen || had?.seen || new Date().toISOString(),
    conns: (had?.conns || 0) + 1,
  };
}

/**
 * WHERE THE ROOM IS LOOKING - which is the educator's screen, or a shared one.
 *
 * It was `leaderPosition` and the rename is the feature: while a student's screen is being
 * shared, every following client renders THAT instead. Two functions would mean each caller
 * choosing between them, and a caller that chose wrong would leave one part of the screen
 * following the class and another following the educator.
 *
 * The shared position is the controlled student's own reported position, not the drive that
 * caused it - so what the class sees is what that screen actually shows rather than what it
 * was told to show. One hop longer and the only version that cannot drift.
 *
 * Null until the first `active`, which is the honest answer: a session is started before
 * anybody has said where they are, and guessing at the course's first row would send a class
 * somewhere nobody is.
 */
export function followedPosition() {
  if (control.sub && control.sharing) return room.here[control.sub]?.position || null;
  return delivery.by ? room.here[delivery.by]?.position || null : null;
}

/** Whose screen the room is on, named. The band says it and only it needs to know. */
export const followedName = () =>
  (control.sub && control.sharing ? control.name || 'a classmate' : delivery.name || '');

/* ---- remote control -------------------------------------------------------
 *
 * Four sends and no state of their own: what happened is whatever the server says happened,
 * which arrives as `controlling`. An optimistic local set would put a band on an admin's
 * screen claiming a control that had in fact been refused - and the refusal is the case that
 * matters, because it means somebody else is already helping that student.
 */

/** Am I the one driving somebody? */
export const drivingSomebody = () => !!control.sub && control.by === session.sub;
/** Is my own screen the one being driven? */
export const beingDriven = () => !!control.sub && control.sub === session.sub;

/* Preview has no socket, so these would be four controls that silently do nothing - and a
 * refusal, a band and a whole third mode nobody can reach locally is a mode nobody looks at
 * before shipping. The echo goes through `emitLocal`, so what it exercises is the real
 * `controlling` handler rather than a second way of setting the same fields. */
const echo = c => { if (previewRole()) emitLocal({ type: 'controlling', control: c }); };
const asPlain = () => ({
  sub: control.sub, name: control.name, by: control.by, byName: control.byName,
  sharing: control.sharing, at: control.at,
});

export function takeControl(sub, sharing = false) {
  if (send('control', { sub, sharing: !!sharing })) return;
  echo({
    sub, name: room.here[sub]?.name || '',
    by: session.sub, byName: session.name || '',
    sharing: !!sharing, at: new Date().toISOString(),
  });
}
export function setSharing(on) {
  if (send('sharing', { on: !!on })) return;
  if (control.sub) echo({ ...asPlain(), sharing: !!on });
}
export function releaseControl() {
  if (!send('release')) echo(null);
}

/**
 * Show the class what you are writing, or stop.
 *
 * NOTHING IS SET HERE. The switch is a field on the session row and what comes back is the
 * `syncing` broadcast, so a toggle that was refused - a second admin in the room, a session
 * that has just ended - reads as off rather than lying about a room it never reached. Same
 * rule the four control sends follow, and the echo is the same preview door.
 */
export function setSync(on) {
  if (send('sync', { on: !!on })) return;
  if (previewRole()) emitLocal({ type: 'syncing', on: !!on });
}

/** What the educator has in their editor, on its way to everybody following. */
export const pushEditor = (at, code, cursor) => send('push', {
  at: at ?? null,
  code: String(code ?? ''),
  cursor: cursor ?? null,
});

/** Send the controlled screen somewhere, and what to put in its editor. */
export const drive = where => send('drive', {
  at: where?.at ?? null,
  title: where?.title || '',
  slide: where?.slide ?? null,
  /* Undefined rather than empty when there is nothing to send: a drive that is only a
   * navigation must not blank an editor the student is looking at. */
  code: typeof where?.code === 'string' ? where.code : undefined,
  cursor: where?.cursor ?? undefined,
});

/** What the driven screen currently has in its editor. Sent once, when control begins. */
export const sendBuffer = (at, code) =>
  send('buffer', { at: at ?? null, code: String(code ?? '') });

/** Follow again, from wherever they are now. */
export const catchUp = () => { delivery.following = true; };

/** They moved on their own. Idempotent - every keystroke in an editor comes through here. */
export const wandered = () => { delivery.following = false; };

/** Idle after this long without the person doing anything. Offline is having no socket. */
const IDLE_AFTER = 15 * 60 * 1000;

/**
 * 'here' | 'idle' for somebody connected, 'away' for somebody who is not.
 *
 * Derived, and derived HERE rather than stored: a status field is a second copy of a fact
 * the connection rows already carry, and the copy is the one that goes stale. The threshold
 * is applied on this side for the same reason - nothing has to run a timer over the table
 * to move somebody into idle, and a clock a few seconds out changes a word rather than a
 * fact.
 */
export function presenceOf(sub, now = Date.now()) {
  const p = room.here[sub];
  if (!p) return 'away';
  return now - Date.parse(p.seen || 0) > IDLE_AFTER ? 'idle' : 'here';
}

/* ---- being invited --------------------------------------------------------
 *
 * A STUDENT HAS TO BE ABLE TO FIND OUT A LESSON HAS STARTED, and until this existed they
 * could not: `refreshRunning` was called from the admin's cohort screen and nowhere else, so
 * every student arrived by a link somebody had sent them.
 *
 * IT POLLS, AND THE PLAN SAID IT WOULD BE A PUSH. That was written before the channel had a
 * shape: a push needs the student to already hold a socket, a socket belongs to one cohort,
 * and a student can be in several - so pushing the invitation means either a socket per
 * cohort held all day or abandoning the one-socket-per-tab rule that keeps every listener
 * from firing twice. Neither is worth it for a fact nobody is waiting on to the second.
 * A minute is imperceptible for "your class has started" and costs one query per student.
 *
 * Only while there is nothing better to do: a client already IN a session knows, and one
 * with no session to be invited to is the ordinary case that should cost nothing beyond the
 * poll itself.
 */
/* EIGHT SECONDS. This began at sixty, on the reasoning that nobody is waiting on this to the
 * second - which is true of the fact and false of the moment. An educator starts a lesson and
 * says "join now"; a class watching an unchanged dashboard concludes the thing is broken, and
 * half of them reload before it arrives. Fifteen was still a wait you could notice.
 *
 * The cost is one query per student per eight seconds - for a class of thirty, under four
 * requests a second against a table billed per request. The floor under this is not money but
 * the shape: genuinely instant needs every signed-in student holding a socket all day, and a
 * socket belongs to one cohort while a student can be in several. */
const ASK_EVERY = 8 * 1000;
let asking = null;

const ask = () => { if (!delivery.cohort) refreshRunning().catch(() => {}); };

/* AND IMMEDIATELY ON COMING BACK TO THE TAB, which is the case a timer cannot cover: a
 * student told the lesson has started switches to a tab that has been in the background - and
 * browsers throttle timers in background tabs hard, so the interval they are relying on may
 * not have run for minutes. This is the one moment somebody is actually looking. */
const woke = () => { if (document.visibilityState === 'visible') ask(); };

export function watchForSessions() {
  if (asking) return;
  ask();
  asking = setInterval(ask, ASK_EVERY);
  addEventListener('visibilitychange', woke);
}

export function stopWatchingForSessions() {
  clearInterval(asking);
  asking = null;
  removeEventListener('visibilitychange', woke);
}

/**
 * The session this client is being invited to, or null.
 *
 * ONE, even when several are running: a student in two classes being taught at once has a
 * problem no band can solve, and a list of invitations is a worse answer than the first one.
 * The one already open is never an invitation - that is where they are.
 */
export function invitation() {
  if (delivery.cohort) return null;
  return Object.values(live.running)[0] || null;
}

/** Who is delivering, everywhere. One call, for a screen listing every cohort. */
export async function refreshRunning() {
  live.loading = true;
  try {
    const r = await api('live/session');
    live.running = Object.fromEntries((r.running || []).map(s => [s.cohort, s]));
  } finally {
    live.loading = false;
  }
}

/** One cohort's session and its per-course bookmarks - what the course picker draws. */
export const sessionFor = cohort =>
  api(`live/session?cohort=${encodeURIComponent(cohort)}`);

/**
 * Start delivering, and join the room.
 *
 * The 409 arrives as an ordinary thrown Error carrying the Lambda's sentence, which already
 * names the holder - so a caller shows it rather than inventing wording of its own.
 */
export async function start(cohort, course) {
  const r = await api('live/session', { method: 'POST', body: { cohort, course } });
  remember(r.session, true);
  live.running[cohort] = r.session;
  openChannel(cohort);
  if (previewRole()) previewRoom(r.session, emitLocal, rowsForPreview, () => here?.());
  return r.session;
}

/** Rejoin one this admin already started, or join one somebody else is running. */
export function join(s) {
  remember(s, s.by === session.sub);
  openChannel(s.cohort);
  /* No socket in preview - `socketUrl()` is null without an auth.json - so the room would
   * be permanently empty and the panel, its four states and the band's count would all be
   * things nobody sees before shipping. The script plays real messages at `emitLocal`,
   * which is live.js's own dispatcher - so a scripted room reaches every handler a real
   * socket would, chat's included, rather than a second list somebody has to remember to
   * add to. */
  if (previewRole()) previewRoom(s, emitLocal, rowsForPreview, () => here?.());
}

/* Preview needs somewhere for a scripted tutor to move TO, and only the player knows what
 * rows a course has. Registered by App.vue and forwarded untouched - this module has no
 * more business knowing about a walk here than it does anywhere else. */
let rowsForPreview = () => [];
export const previewRows = fn => {
  rowsForPreview = fn;
  // The summary's stub needs the same walk, and one registration is one thing to forget.
  previewSummaryRows(fn);
};

/**
 * End it, for everyone. The room is told by the Lambda, not from here.
 *
 * `where` is the position the class finished on, and it is sent from the CLIENT because
 * the client is the only thing that knows it until step 4 broadcasts positions. It becomes
 * the cohort's bookmark - not anybody's own place-marker, which the player writes on every
 * move and which answers a different question. Ending without one leaves the previous mark
 * standing rather than clearing it.
 */
export async function end(cohort = delivery.cohort, where = null) {
  if (!cohort) return;
  const q = new URLSearchParams({ cohort });
  if (where?.exercise != null) q.set('exercise', String(where.exercise));
  if (where?.title) q.set('title', where.title);
  /* THE SUMMARY COMES BACK WITH THE ENDING. It is built from tallies on the row being
   * deleted, so this is the last moment anything can produce it without a second read - and
   * the screen that shows it is the one that pressed the button. */
  try {
    const r = await api(`live/session?${q}`, { method: 'DELETE' });
    return r?.summary || null;
  } finally {
    delete live.running[cohort];
    if (delivery.cohort === cohort) forget();
  }
}

/* ---- whether a cohort can be delivered to at all -------------------------- */

/**
 * The courses everyone in a cohort is on.
 *
 * ADMINS ARE LEFT OUT OF THE INTERSECTION, and that is not a detail: an admin has no
 * enrolment rows at all - they see every course because `App.vue` derives it from the admin
 * flag - so a tutor who is also a member of their own cohort would empty this and disable
 * their own Live button. What is wanted is the courses the STUDENTS share.
 */
export function sharedCourses(cohortId, users) {
  const members = (users || []).filter(u => !u.admin && (u.cohorts || []).includes(cohortId));
  if (!members.length) return [];
  return members
    .map(u => u.courses || [])
    .reduce((all, mine) => all.filter(c => mine.includes(c)));
}

/** Is this one already ours? Then the button is a way back in, not a refusal. */
export const mineAlready = cohortId =>
  live.running[cohortId]?.by === session.sub && !!session.sub;

/**
 * Why the Live button is off, or null when it is on. One sentence, because it is a tooltip
 * and a disabled primary button with no reason reads as the feature being broken.
 *
 * In the order a tutor would meet them: archived, empty, no shared course, somebody else
 * already delivering. A session of our OWN is not in the list - that is Rejoin.
 */
export function whyNotLive(cohort, users) {
  if (cohort.archived)
    return 'This intake is archived. Restore it before delivering to it.';
  const members = (users || []).filter(u => !u.admin && (u.cohorts || []).includes(cohort.id));
  if (!members.length)
    return 'Nobody is in this cohort yet, so there is nobody to deliver to.';
  if (!sharedCourses(cohort.id, users).length)
    return `These ${members.length} people are not all on the same course, so there is `
      + 'nothing everyone could follow. Enrol them together first.';
  const held = live.running[cohort.id];
  if (held && !mineAlready(cohort.id))
    return `${held.name || 'Somebody else'} is delivering to this cohort now.`;
  return null;
}
