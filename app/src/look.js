/* LOOK HERE: the educator points at a control, and it is pointed out on every screen in the
 * room at once.
 *
 * A NAME, NEVER A PLACE, and that is the whole design. pointer.js has the argument in full -
 * the shell is 272px and 336px of fixed columns either side of a fluid middle, so a fraction
 * of one person's window lands somewhere else entirely on another's. A pointer answers that
 * by travelling as a fraction of a named REGION and arriving approximately. This has it
 * easier: a control is a thing rather than a place, so only its name travels and each screen
 * rings whatever box its own DOM gives for it. No coordinates, and exact everywhere.
 *
 * A SIXTH FILE, for board.js's and timer.js's reason - a surface the session neither owns nor
 * outlives. THE RESOLVING HALF IS NOT HERE: `showing` and `meantForMe` are in pointer.js,
 * because they are the same question that file already answers - where on this screen is the
 * thing - and because they have to be testable without a browser, which this file is not.
 * jsdom returns zeros from `getBoundingClientRect`, so a test of "is it visible" written
 * against a DOM would pass by accident. `data-show` is still a second vocabulary from
 * `data-point`, and pointer.js says why.
 *
 * ONLY WHERE IT MEANS THE SAME THING. `where` carries the educator's own row, and a client
 * draws nothing unless it is on that row. A student two exercises ahead has a different Check
 * button in front of them, and ringing it says something the educator did not say. It is the
 * rule a shared editor already has - every push names the exercise it belongs to, and the
 * other side applies it nowhere else - met for the third time, which is usually the sign it
 * is right. The strict reading was chosen over splitting the names into chrome and work: one
 * rule is worth more than the few extra arrows the second would buy.
 *
 * IT IS A MOMENT AND IS WRITTEN DOWN NOWHERE. The board and the timer ride the session row
 * because somebody joining late has to arrive already knowing; this lasts ten seconds, and a
 * student who walks in a minute later must not be shown an arrow over a button that was
 * explained before they got there. So there is no roster field and nothing to restore.
 */
import { reactive, ref, watch } from 'vue';
import { on, send, emitLocal } from './live.js';
import { previewRole } from './preview.js';
import { delivery } from './delivery.js';
export { showing, meantForMe } from './pointer.js';

/** How long an instruction stands. Ten seconds is long enough to look up from an exercise,
 *  find the thing and act on it, and short enough that it is gone before the next one. */
export const LOOK_SECONDS = 10;

/* A NAME IS ONE OF OURS AND ARRIVES OFF A SOCKET, so it is checked rather than escaped -
 * pointer.js's rule and its exact pattern, because both end up inside an attribute selector.
 * `CSS.escape` would do in a browser and validating is the better answer anyway: the set is
 * closed and short, and anything else is a message this version does not understand. */
const NAME = /^[a-z][a-z0-9-]{0,30}$/;

/**
 * What the room has been asked to look at. `at` is the name of a control; `where` is the row
 * the educator was on when they said so, or null when the room does not yet know where they
 * are.
 *
 * `when` changes on every instruction, so whatever draws it watches the MESSAGE rather than
 * the name: pointing twice at the same button is two instructions, and a watcher on the name
 * alone would see the second as nothing having changed.
 */
export const look = reactive({ at: null, where: null, when: null });

/**
 * WHETHER THE EDUCATOR'S OWN CLICKS ARE POINTING RATHER THAN PRESSING.
 *
 * LOCAL, and it is the one switch in this feature that is not a fact about the lesson. The
 * room does not need to know: what it changes is what a click does in this browser, and
 * students only ever see the instructions that result. So there is no write, no condition,
 * and nothing to read back - which is why this is a plain ref where `sync`, the board and the
 * timer are all flags on the session row.
 *
 * NOT REMEMBERED ACROSS A RELOAD, deliberately. It is a mode that swallows presses, and
 * coming back into it silently after a refresh is how somebody concludes the player is
 * broken.
 */
export const pointing = ref(false);

/* ------------------------------------------------------------------ applied from the wire */

on('looking', m => {
  if (!NAME.test(String(m.at || ''))) return;
  look.at = m.at;
  /* Undefined and null are the same answer here - the educator has not said where they are,
   * or an older deployment did not carry it - and both mean draw. Refusing on a missing
   * position would be a guess in the other direction, in the first seconds of a lesson when
   * nobody knows where anybody is. */
  look.where = m.where ?? null;
  look.when = m.when || new Date().toISOString();
});

/** Nothing is standing any more: it was answered, it ran out, or the reader moved. */
export function stopLooking() {
  look.at = null;
  look.where = null;
  look.when = null;
}

/* A different session is a different lesson. The mode goes with it: a switch that swallowed
 * clicks would otherwise survive into a screen with nobody to point anything out to. Watched
 * rather than told, so delivery.js goes on having no idea this file exists - chat.js's rule. */
watch(() => delivery.cohort, () => { stopLooking(); pointing.value = false; });

/* ------------------------------------------------------- the educator's gesture

   THE PRESS IS CONSUMED. While the switch is on, a click on a named control points at it and
   does not work it - so Next does not advance, and "look at this, but do not press it yet" is
   a thing an educator can say. That is also what makes the whole gesture free of a second
   step: there is nothing to arm and nothing to aim, the ordinary click IS the instruction.

   CAPTURE PHASE, on the document, so it never reaches the control at all. It follows that a
   control which acted on `pointerdown` rather than on `click` would still fire - every name
   in the set today is an ordinary button, and a future one that is not needs to be named here
   rather than discovered in a lesson. */
function taken(event) {
  const el = event.target?.closest?.('[data-show]');
  if (!el || !NAME.test(el.dataset.show || '')) return;
  event.preventDefault();
  event.stopPropagation();
  point(el.dataset.show);
}

watch(pointing, on => {
  if (on) document.addEventListener('click', taken, true);
  else document.removeEventListener('click', taken, true);
});

/**
 * Point at a control by name.
 *
 * The educator hears their own back like everybody else - `sync`'s read-back rule - and here
 * it does a second job: the arrow appearing on their own screen is the confirmation that the
 * press was taken rather than swallowed.
 */
export function point(name) {
  if (!NAME.test(String(name || ''))) return false;
  if (send('look', { at: name })) return true;
  /* No socket under `icecore dev`, and a control that silently does nothing is worse than one
   * that is not there. The preview says nothing about `where`, which reads as "the educator
   * has not reported a position" and draws - the refusal is reachable locally from the
   * student's side instead, where the scripted room can say where the educator is. */
  if (previewRole()) { emitLocal({ type: 'looking', at: name, when: new Date().toISOString() }); return true; }
  return false;
}

