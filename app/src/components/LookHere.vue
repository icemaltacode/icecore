<script setup>
/* THE ARROW. An educator points at a control and it is pointed out here, over whatever this
 * screen's copy of that control turns out to be.
 *
 * DRAWN OVER THE CONTROL, NEVER ON IT, and that is not a detail. A class added to the button
 * itself would be clipped by any pane that scrolls - the sidebar's rail, the participants
 * list - and it would fight the control's own `:hover` and `.urge`, which is the same accent
 * saying a different thing. A fixed layer has neither problem and costs a reposition on
 * scroll.
 *
 * IT POINTS AT THE THING. Above the control the arrow points DOWN and below it points UP,
 * each nodding towards what it names; which side it takes is decided by which side has room
 * inside the window. An arrow that takes a side and then does not point that way is the one
 * mistake this drawing can make and the only one a reader will notice.
 *
 * ORANGE, and deliberately the drive one. `--ice-drive` already means somebody else is in
 * your session - the caret while you are being driven, the band that says so - and an
 * educator reaching into your screen to point at something is that same fact. Not the accent:
 * primary is the colour of every button on the page, so a ring in it disappears into the
 * furniture on the one screen where it must not.
 *
 * TEN SECONDS, OR UNTIL IT IS ANSWERED. Pressing the thing being pointed at takes the arrow
 * away at once, on that screen alone - `.btn.urge`'s rule, which the Nudges section states
 * for the two nudges that already exist: whoever sets one owns clearing it, and a student who
 * has already done the thing is being nagged. Nothing is broadcast when it goes; each screen
 * answers for itself.
 */
import { ref, watch, onUnmounted, nextTick } from 'vue';
import { look, showing, meantForMe, stopLooking, LOOK_SECONDS } from '../look.js';

const props = defineProps({
  /** The row this client is on, so an instruction for another one can be declined. */
  here: [String, Number],
});

/* Where to draw, in viewport pixels, or null for nothing. The box is re-read rather than
 * remembered: the pane under it can scroll, a panel can open, and a ring left at the first
 * answer would drift off the thing it names. */
const box = ref(null);
const side = ref('above');
const label = ref('');

let target = null;
let dying = null;

function release() {
  clearTimeout(dying);
  dying = null;
  if (target) {
    target.removeEventListener('click', answered, true);
    target = null;
  }
  window.removeEventListener('scroll', follow, true);
  window.removeEventListener('resize', follow);
  box.value = null;
}

/** They pressed it. The instruction has been carried out, so it stops asking. */
function answered() { release(); stopLooking(); }

function follow() {
  if (!target) return;
  const b = target.getBoundingClientRect();
  if (!b.width || !b.height) { release(); return; }
  /* Above unless there is no room above, which is the whole of the rule. 46px is the arrow
   * plus its gap; below that it would be drawn off the top of the window and the control
   * would be pointed at by something nobody can see. */
  side.value = b.top >= 46 ? 'above' : 'below';
  box.value = { left: b.left, top: b.top, width: b.width, height: b.height };
}

watch(() => look.when, async when => {
  release();
  if (!when || !look.at) return;
  /* NOT FOR THIS SCREEN. Drawing nothing is the whole answer - see look.js for why the strict
   * reading won. */
  if (!meantForMe(look.where, props.here)) return;

  const el = showing(look.at);
  if (!el) return;

  /* SCROLLED OUT OF SIGHT IS THE ONE CASE WORTH MOVING FOR: a ring round something below the
   * fold says nothing at all. `nearest` shifts the pane it is in by the least that makes it
   * visible and never scrolls anything that already is - it moves the view, never the lesson.
   * Instant rather than smooth, because the box has to be measured on the next frame and a
   * smooth scroll is still travelling then. */
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  await nextTick();

  target = el;
  label.value = el.dataset.label || '';
  follow();
  if (!box.value) { target = null; return; }

  target.addEventListener('click', answered, true);
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  dying = setTimeout(() => { release(); stopLooking(); }, LOOK_SECONDS * 1000);
});

/* A READER WHO MOVES HAS LEFT THE INSTRUCTION BEHIND. The rule that decided whether to draw
 * it is about where they are, so it has to go on being true afterwards - and a student who
 * navigates mid-lesson has stopped following, which is exactly the case the rule exists for. */
watch(() => props.here, () => { if (box.value) { release(); stopLooking(); } });

onUnmounted(release);
</script>

<template>
  <!-- Out of flow and taking no clicks: it floats over a working screen, and a ring that
       swallowed the press would be an instruction that cannot be carried out. -->
  <div v-if="box" class="lookhere" :class="side" role="status" aria-live="polite">
    <span class="lookring"
          :style="{ left: `${box.left - 4}px`, top: `${box.top - 4}px`,
                    width: `${box.width + 8}px`, height: `${box.height + 8}px` }"></span>

    <svg class="lookarrow" width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"
         :style="{ left: `${box.left + box.width / 2 - 13}px`,
                   top: side === 'above' ? `${box.top - 42}px` : `${box.top + box.height + 8}px` }">
      <!-- Two glyphs rather than one rotated, so each is drawn with its stem where the eye
           expects it: the head is always the end nearest the thing. -->
      <path v-if="side === 'above'" d="M9 0 h8 v20 h5 L13 34 L4 20 h5 Z" fill="currentColor" />
      <path v-else d="M13 0 L22 14 h-5 v20 H9 V14 H4 Z" fill="currentColor" />
    </svg>

    <!-- SAID IN WORDS AS WELL, because a ring is invisible to a screen reader and the name is
         the thing the educator actually said out loud. The word is this screen's own - the
         same `contents` is Contents in an open sidebar and the menu in a collapsed one. -->
    <span class="lookword">Your educator is pointing at {{ label || 'something on screen' }}.</span>
  </div>
</template>

<style scoped>
/* Unique root class, like every other component here - Vue's scoped CSS reaches a child
   component's root, and `ring` and `arrow` are names something else will want. */
.lookhere { position: fixed; inset: 0; z-index: 62; pointer-events: none; }

.lookring { position: absolute; border: 2px solid var(--ice-drive-line); border-radius: 12px;
            box-shadow: 0 0 0 0 var(--ice-drive-halo); }
.lookarrow { position: absolute; color: var(--ice-drive-line);
             filter: drop-shadow(0 4px 10px rgb(0 0 0 / .28)); }

/* The product's own nudge, in the pointing colour and with an end to it - see the Nudges
   section in CLAUDE.md. One shape for "there is a thing to do here"; a second one written
   slightly differently is how a product ends up with a tic. */
@media (prefers-reduced-motion: no-preference) {
  .lookring { animation: look-urge 1.9s ease-out infinite; }
  .lookhere.above .lookarrow { animation: look-nod-down 1.1s ease-in-out infinite; }
  .lookhere.below .lookarrow { animation: look-nod-up 1.1s ease-in-out infinite; }
}
@keyframes look-urge {
  0%        { box-shadow: 0 0 0 0 var(--ice-drive-halo); }
  55%       { box-shadow: 0 0 0 9px transparent; }
  56%, 100% { box-shadow: 0 0 0 0 transparent; }
}
/* Towards the thing, never away from it: the arrow leans in and comes back. */
@keyframes look-nod-down { 0%, 100% { transform: translateY(-5px); } 50% { transform: translateY(2px); } }
@keyframes look-nod-up { 0%, 100% { transform: translateY(5px); } 50% { transform: translateY(-2px); } }

/* For a reader rather than a viewer. Not `display: none`, which takes it out of the
   accessibility tree along with everything else. */
.lookword { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
            overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
