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
import { delivery } from './delivery.js';

/** The stage. 16:9 because that is what a slide is and what most screens are. */
export const STAGE = { w: 1600, h: 900 };

/* WHAT ONE PAGE MAY WEIGH, and it is a ceiling rather than a target.
 *
 * Mirrors CAP in decksync.js, and for the identical reason: API Gateway does not truncate or
 * reject an oversized frame, it CLOSES THE CONNECTION - which reads as the room going quiet
 * rather than as a message being too big. A dedicated full-screen board reaches this faster
 * than a slide annotation does, because `stylus` mode emits a filled outline with a point
 * every few pixels.
 *
 * A page over it is not sent, and the educator is TOLD. Dropping it quietly would leave a
 * board that still looks right on the one screen that does not matter. */
export const PAGE_LIMIT = 24 * 1024;

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
  /* The last page that could not be sent, so the surface can say so. Cleared by anything
   * that makes it untrue - a new page, a fresh board, an undo that brings it back under. */
  full: false,
});

/** The page showing, which is a string even when nothing has been drawn on it. */
export const current = () => board.pages[board.page] || '';

/* ------------------------------------------------------------------ applied from the wire

   NOTHING BELOW DECIDES ANYTHING. The board is a fact about the LESSON, not about this
   browser, so every state change here arrives as a message - including the educator's own.
   Their button sends and their overlay opens off what comes back, which is `sync`'s rule: a
   board that said it was up when the write had been refused is worse than one that lags. */

/** A board opened or closed. `mine` is not in the message: this client already knows. */
function applyBoarding(on, page = 0) {
  if (!on) { board.on = false; board.mine = false; return; }
  board.pages = [''];
  board.page = Math.max(0, page | 0);
  /* A board with a page index and no pages before it is a board that cannot draw its
   * thumbnails or load its own page. Grown rather than assumed. */
  while (board.pages.length <= board.page) board.pages.push('');
  board.full = false;
  board.id = null;
  board.title = '';
  board.rev += 1;
  board.mine = !!delivery.mine;
  board.on = true;
  /* AND THEN CARRY ON FROM THIS TOPIC'S BOARD, if the class has one. Asked for by whoever
   * pressed the button and acted on HERE rather than there, because a resume has to happen
   * after the flag has come back and been applied - `applyBoarding` resets the pages, so a
   * resume racing it would be wiped by the thing that opened the board. */
  const resume = board.mine ? wanted : null;
  /* Cleared whatever happens. It is one board's intention and a second `boarding` - a
   * reconnection, somebody else's lesson - must not act on it again. */
  wanted = null;
  if (!resume) return;
  const at = boardsAt(resume.topic);
  /* The latest, because the server returns a topic's boards oldest first and the one you want
   * to carry on from is the one you were last drawing on. A failure leaves the blank board
   * that is already up, which is the right thing to be left with. */
  const last = at[at.length - 1];
  if (last) reopen(last).catch(() => {});
}

/** A page in full: a turn, an undo, a clear, or what a joiner walked in on. */
function applyPage(page, svg) {
  const i = Math.max(0, page | 0);
  const pages = [...board.pages];
  while (pages.length <= i) pages.push('');
  pages[i] = typeof svg === 'string' ? svg : '';
  board.pages = pages;
  board.page = i;
  board.full = false;
  board.rev += 1;
}

/* One stroke, appended. FOR THE PAGE IT WAS DRAWN ON, never for whichever page happens to be
 * showing: a page turn and a finished stroke can cross on the wire, and the Lambda drops a
 * stroke for a page nobody is on for the same reason this does not guess. */
function applyStroke(page, node) {
  const i = Math.max(0, page | 0);
  if (typeof node !== 'string' || !node) return;
  const pages = [...board.pages];
  while (pages.length <= i) pages.push('');
  pages[i] = (pages[i] || '') + node;
  board.pages = pages;
}

on('boarding', m => applyBoarding(m.on, m.page));
on('paged', m => applyPage(m.page, m.svg));
on('stroked', m => applyStroke(m.page, m.node));
/* The row cannot take another stroke on this page. Told to the educator rather than
 * swallowed: their own screen looks perfect, and the thing that has stopped is the class
 * seeing it. Same sentence the local ceiling produces, from the other end. */
on('boardfull', () => { board.full = true; });

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
 * This is also the only message that carries what is ALREADY DRAWN, because a joiner needs
 * the page rather than the news that there is one. */
on('roster', m => {
  if (!m.board?.on) { if (board.on) applyBoarding(false); return; }
  applyBoarding(true, m.board.page);
  applyPage(m.board.page, m.board.svg);
});

/* A different session is a different board. Watched rather than being told, so that
 * delivery.js goes on having no idea this file exists - chat.js's rule. */
watch(() => delivery.cohort, () => {
  board.on = false; board.mine = false; board.pages = ['']; board.page = 0;
  /* WHOSE BOARDS ARE VISIBLE CHANGES WITH THE LESSON, in both directions: starting one is how
   * an educator comes to see the room's, and ending it is how they stop. Re-read rather than
   * left as it was, or the paperclip goes on offering a class's boards to somebody who is no
   * longer standing in front of them. */
  if (saved.course) loadSaved(saved.course);
});

/* ------------------------------------------------------------------ the educator's gestures

   Each one is a send. The local state moves when the answer arrives, except for a stroke and
   a page, which are the educator's own DOM and are already on their screen - see the Lambda,
   which deliberately does not echo those two back. */

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

/** Turn to a page that already exists, and take the room with you. */
export function turnTo(i) {
  if (!goPage(i)) return false;
  send('page', { page: board.page, svg: current() });
  return true;
}

/** A fresh page at the end, which is where a new one always goes. */
export function addPage() {
  newPage();
  send('page', { page: board.page, svg: '' });
}

/**
 * A finished stroke, on its way to the room.
 *
 * THE APPEND IS THE COMMON CASE and the reason the whole page is not sent on every change: a
 * page accumulates for the length of a lesson and `stylus` mode emits a filled outline with a
 * point every few pixels. `svg` is the page as it now stands, kept locally so the thumbnails
 * and the ceiling are about what is actually on the board.
 */
export function commitStroke(node, svg) {
  const room = setPage(svg);
  if (room && node) send('stroke', { page: board.page, node });
  return room;
}

/**
 * The page in full, for a change that is not an append.
 *
 * Undo, redo, clear and an erased stroke all remove or reorder nodes, so a stream of appends
 * cannot express them. Refused when the page is over its ceiling - `setPage` says so - which
 * is the one place the educator finds out that the class has stopped seeing this page.
 */
export function commitPage(svg) {
  const room = setPage(svg);
  if (room) send('page', { page: board.page, svg: current() });
  return room;
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
  board.full = false;
  return true;
}

/**
 * Record what is on the page now.
 *
 * OVER THE LIMIT IS STILL RECORDED LOCALLY, and only flagged. The educator's own board is
 * their DOM and refusing to remember what is on it would be undoing their stroke for them;
 * what the ceiling governs is what may be SENT. So this keeps it and says it is full, and the
 * transport declines - which is the difference between "you cannot draw that" and "the class
 * has stopped seeing this page", and only the second one is true.
 */
function setPage(svg) {
  const text = typeof svg === 'string' ? svg : '';
  const pages = [...board.pages];
  pages[board.page] = text;
  board.pages = pages;
  board.full = text.length > PAGE_LIMIT;
  return !board.full;
}

/* ------------------------------------------------------------------ keeping one

   THE ONE THING HERE THAT IS NOT ON THE SOCKET. A board being up is a fact about right now
   and belongs on the channel; a board being KEPT is durable state, and durable state has a
   function of its own - see infra/lambda/boards. The cohort is not passed by the caller
   either: it is whichever lesson this client is in, and the Lambda checks against the live
   session row that the caller is the one delivering to it.
*/
export async function keepBoard({ course, topic, title }) {
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
  board.full = false;
  board.id = entry.board;
  board.rev += 1;
  send('page', { page: 0, svg: current() });
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
  board.full = false;
  board.rev += 1;
  send('page', { page: board.page, svg: current() });
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
  send('page', { page: 0, svg: '' });
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
