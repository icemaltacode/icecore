/* THE WHITEBOARD: a blank surface over the whole player, drawn on by the educator - and,
 * below, the boards that were kept afterwards.
 *
 * Both halves are here because both are the same subject, and a second file would be a second
 * idea of what a board is. They are otherwise unrelated: the top half is a live surface on the
 * socket, the bottom is durable state behind an HTTP route, and nothing crosses between them
 * except `keepBoard`, which is the moment one becomes the other.
 *
 * A FOURTH FILE rather than more of delivery.js, for the reason chat.js is a third. That one
 * is the SESSION - who is delivering, to whom, and where they are. This is a surface, which
 * the session neither owns nor outlives: a board can be up or down without anything about
 * the lesson changing, and a lesson runs perfectly well with no board in it.
 *
 * WHY IT IS AN OVERLAY AND NOT A ROW IN THE WALK, which is the decision everything else here
 * rests on: an overlay does not MOVE anybody. `following` exists because being sent to the
 * educator's position loses a student's place - see App.vue, where navigating for yourself
 * drops you out of follow - so a board that were a row could not be shown to somebody working
 * at their own pace without taking their place away from them. Nothing underneath the overlay
 * changes, so closing it returns every student to their own row rather than the educator's,
 * and the board can simply be shown to the room. As a row, none of that sentence is true.
 *
 * A FIXED STAGE, IN ITS OWN COORDINATES. The board is 1600x900 and every screen letterboxes
 * it identically, the EDUCATOR'S INCLUDED. drauu maps pointer events through the SVG's CTM
 * (`coordinateTransform`, on by default), so with a `viewBox` a stroke is stored in board
 * units rather than screen pixels - which is what makes one dump render the same on a laptop,
 * a 4K monitor and a phone. It is also the whole reason this is a blank surface rather than a
 * transparent layer over the UI: pointer.js has the argument in full, and the short version is
 * that the shell is fixed pixels either side of a fluid middle, so a stroke drawn over the
 * educator's result grid lands over something else on a student's screen. A dot has no shape
 * and survives being moved; a circle drawn round a cell arrives as an ellipse.
 *
 * PAGES ARE DUMPS, oldest first, and the educator turns them. One authority for what the room
 * is looking at, the same rule the deck's page obeys.
 */
import { reactive, watch } from 'vue';
import { on, send, emitLocal } from './live.js';
import { previewRole } from './preview.js';
import { api } from './auth.js';
import { delivery, FRESHER } from './delivery.js';
import { bytes } from './parts.js';
import { TAB } from './tab.js';

/** The stage. 16:9 because that is what a slide is and what most screens are. */
export const STAGE = { w: 1600, h: 900 };

/* A PAGE HAS NO CEILING ON THE WIRE. It used to be 24KB, and it gated every STROKE on the
 * size of the whole page: a few handwritten words in and the board stopped reaching the class,
 * although each stroke was a few hundred bytes. The real limit is on one MESSAGE - API Gateway
 * closes the sender's connection over it (see parts.js) - so that is what is measured now:
 *
 *   - a stroke goes on its own while it fits one frame, and as a whole page if it does not;
 *   - a whole page goes in parts when it needs to, like a slide's annotations.
 *
 * What is left is the size of a KEPT page, which is a DynamoDB row of its own (the boards
 * function) - 400KB, less its keys. Past this the page is still drawn and still reaches the
 * class; what the educator is told is that it cannot be kept. */
export const STROKE_BYTES = 24 * 1024;
export const KEEP_LIMIT = 350 * 1024;
/* AND A WHOLE BOARD GOES IN ONE REQUEST, which Lambda caps at 6MB - as JSON, where every quote
 * in the SVG doubles. Well past any lesson; said plainly rather than failing as a 413. */
const KEEP_TOTAL = 5 * 1024 * 1024;

export const board = reactive({
  /** Is a board up in this lesson at all. */
  on: false,
  /** May this client draw on it. The educator holds the pen; nobody else ever does. */
  mine: false,
  /** Every page, oldest first, each one a drauu dump. A board always has at least one. */
  pages: [''],
  /** Which page the room is looking at. */
  page: 0,
  /* BUMPED WHENEVER THE PAGES ARE REPLACED WHOLESALE - a board opening, a page arriving in
   * full, a kept board being reopened. The surface reloads on it.
   *
   * It cannot watch `pages` instead: `setPage` replaces that array on every stroke, so the
   * surface would reload itself out from under the pen. And it cannot watch `page` alone,
   * because reopening a board onto the page you are already on changes no index at all. */
  rev: 0,
  /* THE SAVED BOARD'S OWN IDENTITY, once it has one. Null until it is kept, and then carried
   * so that pressing Keep a second time in the same lesson UPDATES the board rather than
   * leaving the class two of them - the second half of a board being a document rather than
   * a snapshot. Reset by starting a new board, which is a different document. */
  id: null,
  /* The kept board's title, when this one came from a kept board. Re-keeping prefills with
   * it rather than with the topic label - otherwise carrying on from "The one Ryan asked
   * about" and pressing Keep quietly renames it to "1.1.2 - 2D NumPy Arrays". */
  title: '',
  /* The page showing is too big to KEEP - see KEEP_LIMIT. It still reaches the class; this is
   * said so that it is not found out at the end of the lesson, when Keep refuses. */
  full: false,
});

/** The page showing, which is a string even when nothing has been drawn on it. */
export const current = () => board.pages[board.page] || '';

/* ------------------------------------------------------------------ the transport

   THE EDUCATOR'S BROWSER IS THE SOURCE OF THE DRAWING, and the server only relays it.

   It used to keep the page on the session row, which is a 400KB DynamoDB item shared with the
   chat - so the page had to stay small, and a 24KB ceiling on it stopped a board reaching the
   class a few handwritten words in. Now the row holds only that a board is up. A student who
   joins, or who finds they have missed something, asks (`wantpage`) and the educator's tab
   answers with the page, to them alone. What that costs: while the educator's connection is
   down, a student joining sees the board when it comes back rather than at once.

   EVERY CHANGE IS NUMBERED. A stroke says which version it follows (`after`) and which it
   makes (`v`); a whole page says which version it is. Messages are concurrent invocations and
   overtake one another - the same fault a demonstration's pushes and a drive's buffers had -
   so a stroke that arrives before the one it follows is HELD, applied when the gap closes, and
   if it does not close a whole page is asked for. `epoch` names one run of the educator's tab:
   a reload starts again from one, and that must not read as old.

   NOTHING BELOW DECIDES WHETHER A BOARD IS UP. That is a fact about the LESSON and arrives as
   `boarding`, including for the educator's own button - `sync`'s rule: a board that said it
   was up when the write had been refused is worse than one that lags. */

/* WHICH OF THE EDUCATOR'S TABS HOLDS THE PEN. A control tab also belongs to whoever is
 * delivering, and with two surfaces two different drawings would each answer a student asking
 * for the page. So App.vue says which tab this is, and a control tab watches the board the way
 * the class does. */
let source = true;
export function boardSource(on) {
  source = !!on;
  if (board.on) board.mine = !!delivery.mine && source;
}

// The source's own count. `version` is the one the page on screen is at.
let epoch = `${TAB}-${Date.now().toString(36)}`;
let counter = 0;
let version = 0;

// What a watching client has applied, and what arrived too early to apply.
let heard = { epoch: null, v: 0, page: -1 };
let early = [];
let repairing = null;
let askedAt = 0;
const EARLY_MAX = 400;
const REPAIR_AFTER = 1500;
const ASK_EVERY = 2000;

/* A STUDENT'S SURFACE APPENDS A STROKE rather than re-rendering the page, so it is told. A
 * page redrawn in full on every stroke is fine at a few KB and is not at a few hundred. */
const strokeWatchers = new Set();
export function onStroke(fn) { strokeWatchers.add(fn); return () => strokeWatchers.delete(fn); }

/** A board opened or closed. `mine` is not in the message: this client already knows. */
function applyBoarding(on, page = 0) {
  if (!on) {
    if (board.mine) forgetStored(delivery.cohort);
    board.on = false; board.mine = false;
    heard = { epoch: null, v: 0, page: -1 }; early = [];
    return;
  }
  board.pages = [''];
  board.page = Math.max(0, page | 0);
  /* A board with a page index and no pages before it is a board that cannot draw its
   * thumbnails or load its own page. Grown rather than assumed. */
  while (board.pages.length <= board.page) board.pages.push('');
  board.full = false;
  board.id = null;
  board.title = '';
  heard = { epoch: null, v: 0, page: -1 }; early = [];
  board.mine = !!delivery.mine && source;
  /* A RELOADED SOURCE PICKS UP WHERE IT WAS. With nothing on the server, the educator's own
   * tab is the only copy of the drawing, and a reload used to be answered by the row. */
  if (board.mine) {
    const kept = restored();
    if (kept?.pages?.length) {
      board.pages = kept.pages.map(p => String(p ?? ''));
      board.page = Math.min(Math.max(0, kept.page | 0), board.pages.length - 1);
      board.id = kept.id || null;
      board.title = kept.title || '';
    }
  }
  board.rev += 1;
  board.on = true;
  if (board.mine) sendPage();
  else askForPage();
  /* AND THEN CARRY ON FROM THIS TOPIC'S BOARD, if the class has one. Asked for by whoever
   * pressed the button and acted on HERE rather than there, because a resume has to happen
   * after the flag has come back and been applied - `applyBoarding` resets the pages, so a
   * resume racing it would be wiped by the thing that opened the board. */
  const resume = board.mine ? wanted : null;
  /* Cleared whatever happens. It is one board's intention and a second `boarding` - a
   * reconnection, somebody else's lesson - must not act on it again. */
  wanted = null;
  if (!resume) return;
  const found = boardsAt(resume.topic);
  /* The latest, because the server returns a topic's boards oldest first and the one you want
   * to carry on from is the one you were last drawing on. A failure leaves the blank board
   * that is already up, which is the right thing to be left with. */
  const last = found[found.length - 1];
  if (last) reopen(last).catch(() => {});
}

/** A page in full, drawn: a turn, an undo, a clear, or what a joiner walked in on. */
function replacePage(page, svg) {
  const i = Math.max(0, page | 0);
  const pages = [...board.pages];
  while (pages.length <= i) pages.push('');
  pages[i] = typeof svg === 'string' ? svg : '';
  board.pages = pages;
  board.page = i;
  board.rev += 1;
}

/* One stroke, appended. FOR THE PAGE IT WAS DRAWN ON, never for whichever page happens to be
 * showing: a page turn and a finished stroke can cross on the wire. */
function appendStroke(page, node) {
  const i = Math.max(0, page | 0);
  if (typeof node !== 'string' || !node) return;
  const pages = [...board.pages];
  while (pages.length <= i) pages.push('');
  pages[i] = (pages[i] || '') + node;
  board.pages = pages;
  for (const fn of strokeWatchers) fn(i, node);
}

/* A WHOLE PAGE ARRIVING. Taken if it is from a run of the educator's tab this client has not
 * heard from, or newer than what it has - so a reload's first page always lands, and the same
 * page answered twice (two requests, one reply each) is drawn once.
 *
 * Unnumbered is an educator's tab from before this was deployed, applied as it always was. */
function pageIn(m) {
  if (board.mine) return;
  if (!Number.isInteger(m.v) || typeof m.epoch !== 'string') { replacePage(m.page, m.svg); return; }
  if (m.epoch === heard.epoch && m.v <= heard.v) return;
  replacePage(m.page, m.svg);
  heard = { epoch: m.epoch, v: m.v, page: Math.max(0, m.page | 0) };
  drain();
}

function strokeIn(m) {
  if (board.mine) return;
  if (!Number.isInteger(m.v) || typeof m.epoch !== 'string') { appendStroke(m.page, m.node); return; }
  if (m.epoch === heard.epoch && m.v <= heard.v) return;   // had it
  if (follows(m)) { take(m); drain(); return; }
  early.push(m);
  if (early.length > EARLY_MAX) early.shift();
  if (!repairing) {
    repairing = setTimeout(() => { repairing = null; if (early.length) askForPage(); }, REPAIR_AFTER);
  }
}

const follows = m => m.epoch === heard.epoch && (m.page | 0) === heard.page && m.after === heard.v;
function take(m) { appendStroke(m.page, m.node); heard = { ...heard, v: m.v }; }

/* Apply whatever was waiting on what just arrived, and forget whatever it made stale. */
function drain() {
  for (let moved = true; moved;) {
    moved = false;
    early = early.filter(m => !(m.epoch === heard.epoch && m.v <= heard.v));
    const next = early.find(follows);
    if (next) { early = early.filter(m => m !== next); take(next); moved = true; }
  }
  if (!early.length && repairing) { clearTimeout(repairing); repairing = null; }
}

/* ASK THE EDUCATOR'S TAB FOR THE PAGE, no more than once every two seconds: a class that
 * reconnects together, or a burst of strokes arriving out of order, is one question each. */
function askForPage() {
  if (board.mine || !board.on) return;
  const now = Date.now();
  if (now - askedAt < ASK_EVERY) return;
  askedAt = now;
  send('wantpage');
}

/* When a `boarding` was last heard - see the light roster below, and FRESHER in delivery.js. */
let boardingAt = 0;
on('boarding', m => { boardingAt = Date.now(); applyBoarding(m.on, m.page); });
on('paged', pageIn);
on('stroked', strokeIn);
/* SOMEBODY ASKED FOR THE PAGE, and only the source answers - to them alone, at the version it
 * is at, which is not a change. */
on('pagewanted', m => { if (board.on && board.mine && m.sub) sendPage(m.sub); });

/* THE CLASS'S KEPT BOARDS HAVE CHANGED. The list is read when a course opens and when the
 * lesson changes, which is what keeps a paperclip off the navigation path - and leaves one
 * gap: a board kept in the middle of the lesson it was drawn in, which is when it matters
 * most. This closes it.
 *
 * Only for the course this client actually has open. A cohort can take two, and re-reading a
 * list about the other one would be a request for nothing. */
on('kept', m => { if (saved.course && saved.course === m.course) loadSaved(saved.course); });

/* Off the roster, like control and the editor switch - a client that has just connected, or
 * come back from a tunnel, would otherwise sit under no board at all in the middle of one.
 * THE ROSTER CARRIES NO DRAWING any more; a board being up is answered by asking for it. */
on('roster', m => {
  /* THE LIGHT ONE, every thirty seconds, says only whether a board is up. A board that should
   * be gone is closed here, and one that should be up is asked for in full. Nothing at all
   * when the two agree, which is every tick but the one after a missed `boarding`. */
  if (m.light) {
    if (!('boardOn' in m) || Date.now() - boardingAt < FRESHER) return;
    if (m.boardOn && !board.on) send('roster');
    else if (!m.boardOn && board.on) applyBoarding(false);
    return;
  }
  if (!m.board?.on) { if (board.on) applyBoarding(false); return; }
  /* ALREADY UP IS NOT A NEW BOARD. A full roster arrives on every reconnection, and resetting
   * the pages then would throw away the source's only copy of the drawing. So a source that
   * has come back sends the page - it may have drawn while its socket was down - and a watcher
   * asks for it. */
  if (!board.on) { applyBoarding(true, m.board.page); return; }
  if (board.mine) sendPage();
  else askForPage();
});

/* A different session is a different board. Watched rather than being told, so that
 * delivery.js goes on having no idea this file exists - chat.js's rule. */
watch(() => delivery.cohort, (now, was) => {
  if (was) forgetStored(was);
  board.on = false; board.mine = false; board.pages = ['']; board.page = 0;
  heard = { epoch: null, v: 0, page: -1 }; early = [];
  /* WHOSE BOARDS ARE VISIBLE CHANGES WITH THE LESSON, in both directions: starting one is how
   * an educator comes to see the room's, and ending it is how they stop. Re-read rather than
   * left as it was, or the paperclip goes on offering a class's boards to somebody who is no
   * longer standing in front of them. */
  if (saved.course) loadSaved(saved.course);
});

/* ------------------------------------------------------------------ the source's own copy

   KEPT IN THE TAB, so a reload is not the end of the drawing. sessionStorage rather than
   localStorage: it is this tab's board, it has a quota of its own - progress-store's keys are
   in localStorage - and it goes when the tab does. Written a moment after the drawing stops
   rather than on every stroke. A write that fails (a full quota) is only a reload that would
   start blank. */
const storeKey = cohort => `ice-board:${cohort}`;
let storing = null;
function store() {
  if (!board.mine || !delivery.cohort) return;
  clearTimeout(storing);
  const cohort = delivery.cohort;
  storing = setTimeout(() => {
    try {
      sessionStorage.setItem(storeKey(cohort), JSON.stringify({
        pages: board.pages, page: board.page, id: board.id, title: board.title,
      }));
    } catch { /* see above */ }
  }, 800);
}
function restored() {
  try { return JSON.parse(sessionStorage.getItem(storeKey(delivery.cohort)) || 'null'); }
  catch { return null; }
}
function forgetStored(cohort) {
  clearTimeout(storing);
  try { if (cohort) sessionStorage.removeItem(storeKey(cohort)); } catch { /* nothing kept */ }
}

/* ------------------------------------------------------------------ the educator's gestures

   Each one is a send. A stroke and a page are the educator's own DOM and are already on their
   screen, so the Lambda does not echo them back. */

/* What the next `boarding` should resume, or null. Held here rather than passed through the
 * message: it is this browser's intention, not a fact about the room - a student receiving
 * the same `boarding` must resume nothing. */
let wanted = null;

/**
 * Put a board up, or take it away.
 *
 * `resume` names the topic being taught. Given one, the board comes up carrying whatever this
 * class already has for that topic - which is what an educator expects of a board in a room,
 * and what stops "open, draw, keep" twice on one topic filing two documents.
 */
export function startBoard(on = true, resume = null) {
  wanted = on ? resume : null;
  if (send('board', { on: !!on })) return true;
  /* No socket in preview, so `--as admin` would have a button that does nothing - and a
   * control that silently refuses is worse than one that is not there. The echo is the same
   * door every other preview message comes through. */
  if (previewRole()) { emitLocal({ type: 'boarding', on: !!on, page: 0 }); return true; }
  return false;
}

/* THE PAGE ON SCREEN, WHOLE. To the room when it has CHANGED - a turn, an undo, a clear, a
 * reopened board - which makes a new version; to one student when they asked, at the version
 * it is already at. Split into parts by live.js when it will not fit one frame. */
function sendPage(to = null) {
  if (!to) version = ++counter;
  send('page', { page: board.page, v: version, epoch, svg: current(), ...(to ? { to } : {}) });
  store();
}

/** Turn to a page that already exists, and take the room with you. */
export function turnTo(i) {
  if (!goPage(i)) return false;
  sendPage();
  return true;
}

/** A fresh page at the end, which is where a new one always goes. */
export function addPage() {
  newPage();
  sendPage();
}

/**
 * A finished stroke, on its way to the room.
 *
 * THE APPEND IS THE COMMON CASE and the reason the whole page is not sent on every change.
 * `svg` is the page as it now stands, kept locally so the thumbnails are about what is
 * actually on the board. A stroke too big for one frame - a scribble across the whole board -
 * goes as the page instead, which is split into parts. There is no ceiling on either.
 */
export function commitStroke(node, svg) {
  setPage(svg);
  if (!node || bytes(JSON.stringify(node)) > STROKE_BYTES) { sendPage(); return true; }
  const after = version;
  version = ++counter;
  send('stroke', { page: board.page, v: version, after, epoch, node });
  store();
  return true;
}

/**
 * The page in full, for a change that is not an append.
 *
 * Undo, redo, clear and an erased stroke all remove or reorder nodes, so a stream of appends
 * cannot express them.
 */
export function commitPage(svg) {
  setPage(svg);
  sendPage();
  return true;
}

/* ------------------------------------------------------------------ the local half */

/* A BOARD ALWAYS HAS A PAGE, so this can never empty `pages`. Everything that draws reads
 * `pages[page]` and a surface with no page to load is a blank that cannot be written on. */
function newPage() {
  board.pages = [...board.pages, ''];
  board.page = board.pages.length - 1;
  board.full = false;
}

function goPage(n) {
  const i = Number(n);
  if (!Number.isInteger(i) || i < 0 || i >= board.pages.length) return false;
  board.page = i;
  board.full = bytes(current()) > KEEP_LIMIT;
  return true;
}

/** Record what is on the page now, and whether it has grown past what can be kept. */
function setPage(svg) {
  const text = typeof svg === 'string' ? svg : '';
  const pages = [...board.pages];
  pages[board.page] = text;
  board.pages = pages;
  board.full = bytes(text) > KEEP_LIMIT;
}

/* ------------------------------------------------------------------ keeping one

   THE ONE THING HERE THAT IS NOT ON THE SOCKET. A board being up is a fact about right now
   and belongs on the channel; a board being KEPT is durable state, and durable state has a
   function of its own - see infra/lambda/boards. The cohort is not passed by the caller
   either: it is whichever lesson this client is in, and the Lambda checks against the live
   session row that the caller is the one delivering to it.
*/
export async function keepBoard({ course, topic, title }) {
  if (board.pages.some(p => bytes(p) > KEEP_LIMIT)) {
    throw new Error('A page is too big to keep. Move some of it onto a new page and try again.');
  }
  if (bytes(JSON.stringify(board.pages)) > KEEP_TOTAL) {
    throw new Error('This board is too big to keep in one go. Remove a page or two and try again.');
  }
  const answer = await api('boards', {
    method: 'POST',
    body: {
      cohort: delivery.cohort, course, topic, title,
      pages: board.pages,
      /* Present only on a re-save. The Lambda generates one when it is absent, which is what
       * makes the first Keep of a board create it and every later one edit it. */
      ...(board.id ? { board: board.id } : {}),
    },
  });
  board.id = answer?.board || board.id;
  /* THE PAPERCLIP IS A READ OF A LIST THIS JUST CHANGED. Without it a board is kept and
   * appears nowhere until the course is opened again - which reads exactly like saving having
   * failed, and the save is the one moment somebody is looking for the result of it. */
  await loadSaved(course);
  /* And everybody else's, who would otherwise not see it until they reloaded the page. The
   * class is told rather than the board being sent: the list is per caller - a student sees
   * their intakes' and the educator sees the room's - so the only honest thing to broadcast
   * is that it changed. */
  send('kept', { course, topic });
  return answer;
}

/* ------------------------------------------------------------------ the ones that were kept

   WHAT A PAPERCLIP READS. Asked once per course rather than once per topic: a paperclip has
   to be drawable on every row, and asking on each navigation would be a round trip a student
   pays for by moving. So the whole course's boards arrive at once and are indexed by topic
   here - which is also what lets the TWO places that draw the paperclip read one lookup. The
   walk is drawn by App.vue and ContentsModal.vue and the two disagreeing reads as things
   going missing; a third and fourth reader asking separately would be the same bug waiting.
*/
export const saved = reactive({
  /** Which course `byTopic` is about, so a stale index is never read as an empty one. */
  course: null,
  /** topic -> boards, newest last. Empty for a topic with none, which is most of them. */
  byTopic: {},
});

/** The boards kept for this topic, for whoever is asking. Never null - drawing reads it. */
export const boardsAt = topic => (topic && saved.byTopic[topic]) || [];

/**
 * Load a course's boards.
 *
 * A FAILURE IS SILENT, and that is the right shape for this one thing: a paperclip is an
 * extra, and a red banner over somebody's exercise because a list of attachments could not be
 * fetched would be the platform making its own plumbing the student's problem. What is lost
 * is a paperclip nobody knew was there.
 */
export async function loadSaved(course) {
  if (!course) { saved.course = null; saved.byTopic = {}; return; }
  saved.course = course;
  saved.byTopic = {};
  /* THE EDUCATOR IS NOT IN THE CLASS, and without this they are the one person who cannot
   * see the board they just drew. The listing answers "what may I, whoever I am, see", and an
   * admin is in no cohorts by design - the same reason their enrolment list is empty. So while
   * they are DELIVERING, the room is named: `mayRead` in the boards function already blesses
   * exactly that case, member or deliverer, which is the rule step six established for
   * reopening a board and is no wider here.
   *
   * Only when it is their lesson. A student in one is a member already, and naming the room
   * for them would narrow their list to it - hiding a board kept for another intake they are
   * also in. */
  const q = new URLSearchParams({ course });
  if (delivery.mine && delivery.cohort) q.set('cohort', delivery.cohort);
  let answer;
  try { answer = await api(`boards?${q}`); }
  catch { return; }
  // A course opened while this was in flight owns the index now.
  if (saved.course !== course) return;
  const byTopic = {};
  for (const b of answer?.boards || []) {
    if (!b?.topic) continue;
    (byTopic[b.topic] ||= []).push(b);
  }
  saved.byTopic = byTopic;
}

/** One board in full. Throws, because here there IS somewhere to say so: a viewer is open. */
export function openSaved({ cohort, topic, board }) {
  const q = new URLSearchParams({ cohort, topic, board });
  return api(`boards?${q}`);
}

/**
 * REOPEN A KEPT BOARD AND CARRY ON FROM IT, which is the step that makes a board a document
 * rather than a snapshot.
 *
 * IT TAKES THE BOARD'S IDENTITY WITH IT. `board.id` is set from the one being opened, so the
 * next Keep rewrites that board instead of leaving the class a second copy of last week's
 * diagram with one more line on it.
 *
 * THE ROOM IS SENT THE PAGE, NOT THE BOARD. Everyone is looking at one page, and every turn
 * from here sends its own - which is exactly how a board drawn from scratch behaves, so there
 * is no second path through the transport for a reopened one.
 */
export async function reopen(entry) {
  const answer = await openSaved(entry);
  board.title = entry.title || '';
  const pages = (answer?.pages || []).map(p => String(p ?? ''));
  board.pages = pages.length ? pages : [''];
  board.page = 0;
  board.full = bytes(current()) > KEEP_LIMIT;
  board.id = entry.board;
  board.rev += 1;
  sendPage();
  return answer;
}

/**
 * REMOVE A PAGE, and with it everything drawn on it.
 *
 * A BOARD ALWAYS HAS A PAGE, so the last one cannot go - a surface with no page to load is a
 * blank that cannot be written on, and "delete the only page" means "clear it", which is a
 * different button that already exists.
 *
 * THE ROOM NEEDS NOTHING BUT THE PAGE IT IS NOW ON. Every client only ever renders the current
 * page, and a turn sends that page in full - so the stale entries a shift leaves behind at
 * other indices are never drawn, and correcting them would be a message about something
 * nobody is looking at.
 */
export function dropPage(i = board.page) {
  const at = Math.trunc(Number(i));
  if (board.pages.length < 2 || at < 0 || at >= board.pages.length) return false;
  const pages = board.pages.filter((_, n) => n !== at);
  board.pages = pages;
  board.page = Math.min(board.page > at ? board.page - 1 : board.page, pages.length - 1);
  board.full = bytes(current()) > KEEP_LIMIT;
  board.rev += 1;
  sendPage();
  return true;
}

/**
 * A BLANK BOARD, ON PURPOSE. The way out of a resumed one.
 *
 * It drops the identity as well as the pages: what is drawn next is a new document, and Keep
 * files it rather than overwriting the board that happened to be open a moment ago. Without
 * that, "start again" and "throw away what the class already has" would be the same gesture.
 */
export function freshBoard() {
  board.pages = [''];
  board.page = 0;
  board.id = null;
  board.title = '';
  board.full = false;
  board.rev += 1;
  sendPage();
}

/** Remove a kept board. Gated on delivering, server-side - see infra/lambda/boards. */
export async function dropBoard(entry) {
  const q = new URLSearchParams({
    cohort: entry.cohort, topic: entry.topic, board: entry.board,
  });
  await api(`boards?${q}`, { method: 'DELETE' });
  /* If the board on screen was that one, it no longer has an identity - the next Keep files a
   * new document rather than trying to update a row that is gone. */
  if (board.id === entry.board) { board.id = null; board.title = ''; }
  await loadSaved(saved.course);
  /* A removal is as much a change to the class's list as a save, and the paperclip left
   * behind on a board that is gone opens onto a 404. */
  send('kept', { course: saved.course, topic: entry.topic });
}

/**
 * The kept boards of the class being taught right now, across the whole course.
 *
 * NAMED RATHER THAN DERIVED. `loadSaved` above answers "what may I, whoever I am, see" and an
 * educator is usually in none of these classes; this asks about ONE class, the one they are
 * standing in front of, and the Lambda allows it only for its members and for whoever is
 * delivering to it. A list that spanned cohorts would hand one class's lesson to another.
 */
export function keptForRoom(course) {
  const q = new URLSearchParams({ course, cohort: delivery.cohort || '' });
  return api(`boards?${q}`);
}
