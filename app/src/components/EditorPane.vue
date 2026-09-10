<script setup>
/* THE STUDENT'S EDITOR, AND THE EDUCATOR'S BESIDE IT.
 *
 * Sharing an editor used to write into the student's own buffer and hand it back when it
 * stopped. That worked, and rested on one stash in App.vue cleared on navigation - so a
 * student who walked out of a demonstration half way left their attempt behind with it. The
 * demonstration is a second thing on the screen now rather than a temporary state of the
 * first, and nothing of theirs is touched: there is nothing to give back.
 *
 * ONE COMPONENT BECAUSE THERE ARE TWO EXERCISE TYPES. SQL and Python both have an editor and
 * both are shared to a class the same way, and a tab bar written twice is how Run comes to
 * mean two things in two halves of one course - the argument `selection.js` already makes.
 *
 * SPLIT WHERE THERE IS ROOM, TABS WHERE THERE IS NOT. A demonstration you have to switch
 * away from your own work to watch is the same lost context the takeover had, moved
 * somewhere politer - so side by side is the real answer and the tabs are the fallback.
 *
 * MEASURED, NOT A MEDIA QUERY. The question is whether two editors fit, and how much room
 * this pane has depends on how much chrome the shell has folded away - so it asks the pane
 * rather than the window. `WIDE` in App.vue is not this number and must not be borrowed: it
 * answers whether a 272px sidebar costs the exercise anything it needs.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import CodeEditor from './CodeEditor.vue';

const props = defineProps({
  /** The student's own buffer. The only one that is ever theirs, and the only one graded. */
  modelValue: String,
  language: { type: String, default: 'sql' },
  /** What their own tab is called - `query.sql`, `script.py`. Decorative, and always shown. */
  name: { type: String, default: 'query.sql' },
  /* Their own editor read-only, for a student whose screen is being DRIVEN. That is remote
   * control, which writes into their own work deliberately - a different thing from sharing,
   * and the one case where somebody else's text belongs in this buffer. */
  readonly: Boolean,
  /** The educator's version for this step, as `{ code, by }`, or null when there is none. */
  shared: Object,
  /** Whether it is arriving RIGHT NOW, as opposed to being read back from a past lesson. */
  live: Boolean,
  /* Somebody else's caret IN THIS STUDENT'S BUFFER - remote control, and nothing else. */
  peerAt: { type: Number, default: null },
  peerAnchor: { type: Number, default: null },
  peerName: String,
  /* And the educator's caret in the educator's own tab, which is where it belongs while a
   * lesson is being delivered to the room. Two different carets in two different documents:
   * passing one where the other is wanted points at characters nobody selected. */
  sharedAt: { type: Number, default: null },
  sharedAnchor: { type: Number, default: null },
});
const emit = defineEmits(['update:modelValue', 'cursor', 'run', 'active']);

const mine = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
});
const theirs = computed(() => props.shared?.code ?? '');
const has = computed(() => typeof props.shared?.code === 'string');
/* Named after the person, not after a file. There is no file concept to borrow - `query.sql`
 * is a decorative label - and a student in two intakes has two of these, told apart by
 * whose they are. `by` is stored with the version for exactly this line. */
const title = computed(() => (props.shared?.by ? `${props.shared.by}'s version` : 'Educator'));

/* ---- which one is on screen ------------------------------------------------
 *
 * Only meaningful when the pane is too narrow to show both. Split, `tab` is what a Run acts
 * on and nothing is hidden by it.
 */
const tab = ref('mine');
const showing = computed(() => (has.value ? tab.value : 'mine'));

/* ---- is there room for two ------------------------------------------------
 *
 * A ResizeObserver rather than a media query, for the reason at the top: the pane's width is
 * the shell's leftovers. Two editors and the divider between them; below it one of them
 * would be too narrow to read a line of code in, which is worse than a tab.
 */
const FITS_TWO = 900;
const wide = ref(false);
const pane = ref(null);
let watcher;
onMounted(() => {
  if (typeof ResizeObserver !== 'function') return;   // jsdom, and old browsers
  watcher = new ResizeObserver(([e]) => { wide.value = e.contentRect.width >= FITS_TWO; });
  watcher.observe(pane.value);
});
onBeforeUnmount(() => watcher?.disconnect());
/* SPLIT ONLY WHILE IT IS LIVE. Side by side is for watching somebody work; once they stop,
 * a second editor holding a finished demonstration is half the screen given to something
 * nobody is changing. It goes back to being a tab - still there, still one click away, and
 * the student's own work has the room again. */
const split = computed(() => has.value && wide.value && props.live);

/* THE FOCUS SNAPS ONCE, when a demonstration starts - and again if the split collapses under
 * one, which is the case that bites: a student who resizes or rotates mid-lesson would
 * otherwise have the demonstration disappear behind a tab they are not on.
 *
 * ONCE, though. A focus that reasserted itself would take the screen back off somebody every
 * time they looked at their own work, and switching to their own tab has to stay a thing
 * they are allowed to do - the educator's tab goes on updating live either way.
 */
watch(() => props.live && has.value && !split.value, on => { if (on) tab.value = 'theirs'; },
      { immediate: true });

/* AND IT HANDS THE SCREEN BACK WHEN THE DEMONSTRATION ENDS. The split collapses to a tab, so
 * something has to be showing - and leaving the student on a read-only copy of somebody
 * else's work at the moment the lesson moves on would take their own away just as they need
 * it. Theirs is one click behind them, which is the whole point of it being a tab. */
watch(() => props.live, (now, was) => { if (was && !now) tab.value = 'mine'; });

/* ---- what a Run would act on ----------------------------------------------
 *
 * Reported upwards rather than resolved here: the buttons live in the exercise component
 * beside Check, and `selection.js` owns every rule about what a highlighted range means. So
 * this says WHICH buffer and where the caret in it is, and the parent says what that runs.
 *
 * Split, the active one is still `tab` - both are visible, and the last one touched is the
 * one a Run is about.
 */
const at = ref({ mine: null, theirs: null });
const report = () => emit('active', {
  mine: showing.value === 'mine',
  code: showing.value === 'mine' ? props.modelValue : theirs.value,
  ...(at.value[showing.value] || { cursor: null, anchor: null }),
});
/* `{ head, anchor }` from an editor. An anchor equal to the head is a bare caret and selects
 * nothing - the spelling `selection.js` expects. */
const moved = (which, { head, anchor }) => {
  at.value[which] = { cursor: head, anchor: anchor === head ? null : anchor };
  /* SPLIT, THE ACTIVE ONE IS WHICHEVER WAS LAST TOUCHED. Both are on screen, so nothing is
   * hidden by the choice - but Run still has to act on one of them, and the editor the caret
   * is in is the only answer a person would predict. The tab bar shows which, so the button
   * and the highlight never disagree. */
  if (split.value) tab.value = which;
  /* ONLY THEIR OWN GOES UP THE OTHER PIPE. What is reported to the educator is where this
   * student is in THEIR OWN work; a caret in a read-only copy of the educator's buffer is
   * not that, and drawing it back on the educator's screen would point at nothing. */
  if (which === 'mine') emit('cursor', { head, anchor });
  report();
};
watch(() => [props.modelValue, theirs.value, showing.value], report, { immediate: true });

/* ---- taking it as your own -------------------------------------------------
 *
 * The one gesture that changes what Check submits, and the whole reason the modal this
 * replaced wanted a checkbox. Made deliberate and made LATE: pressed when the consequence is
 * on screen, rather than ticked before anybody could see whether they wanted it.
 *
 * It asks first only when there is something to lose. A confirmation on an empty starter is
 * a dialog for a no-op, which is how people learn to click through them.
 */
const asking = ref(false);
const worth = () => (props.modelValue || '').trim() && props.modelValue.trim() !== theirs.value.trim();
const use = () => { if (worth()) asking.value = true; else take(); };
function take() {
  asking.value = false;
  mine.value = theirs.value;
  tab.value = 'mine';
  nextTick(report);
}
</script>

<template>
  <div class="pane" ref="pane" data-point="editor">
    <!-- Always drawn, even with nothing to switch to: a tab bar that appears when somebody
         starts sharing is a layout jumping under a student mid-sentence.

         SPLIT, A TAB SITS OVER THE EDITOR IT NAMES. Side by side they are two panes rather
         than two choices, and a pair of tabs huddled at the left names neither - the eye has
         to travel to the far pane and back to work out which is which. So the bar divides
         where the editors do, and each half labels what is under it. Narrow, they are what
         they always were: two tabs, one pane. -->
    <div class="tabbar" :class="{ split }">
      <div class="side">
        <!-- `active` is which one RUN IS ABOUT, not which one is visible: split, both are on
             screen and only one of them is what the button acts on. -->
        <button class="tab" type="button" :class="{ active: showing === 'mine' }"
                @click="tab = 'mine'">{{ name }}</button>
        <button v-if="has && !split" class="tab" type="button"
                :class="{ active: showing === 'theirs' }" @click="tab = 'theirs'">
          {{ title }}<span v-if="live" class="dot" title="Live"></span>
        </button>
        <slot name="right"></slot>
      </div>
      <div v-if="has && split" class="side theirs">
        <button class="tab" type="button" :class="{ active: showing === 'theirs' }"
                @click="tab = 'theirs'">
          {{ title }}<span v-if="live" class="dot" title="Live"></span>
        </button>
      </div>
    </div>

    <div class="editors" :class="{ split }">
      <!-- v-show, not v-if: a CodeMirror instance rebuilt on every tab switch loses the undo
           history and the scroll position, and the split flips this twice on a resize. -->
      <div v-show="split || showing === 'mine'" class="one">
        <CodeEditor v-model="mine" :language="language" :readonly="readonly"
                    :peer-at="peerAt" :peer-anchor="peerAnchor" :peer-name="peerName"
                    @cursor="moved('mine', $event)" @run="emit('run')" />
      </div>

      <div v-if="has" v-show="split || showing === 'theirs'" class="one theirs">
        <!-- READ-ONLY, ALWAYS, AND NOT ONLY WHILE IT IS LIVE. While it is, two people typing
             into one buffer is not a thing this can do. Afterwards it is the record of what
             was shown - and a record somebody can edit is not one they can refer back to,
             which is the whole reason it is kept. Runnable, though: running the educator's
             code to see what it does is what a demonstration is for. -->
        <CodeEditor :model-value="theirs" :language="language" readonly
                    :peer-at="live ? sharedAt : null" :peer-anchor="live ? sharedAnchor : null"
                    :peer-name="shared?.by"
                    @cursor="moved('theirs', $event)" @run="emit('run')" />

        <div v-if="asking" class="ask">
          <p>Replace what you have written with {{ shared?.by || 'the educator' }}'s version?
            Your own answer is not kept.</p>
          <div class="acts">
            <button class="btn" type="button" @click="take">Replace mine</button>
            <button class="btn ghost" type="button" @click="asking = false">Keep mine</button>
          </div>
        </div>
        <div v-else class="use">
          <button class="link" type="button" @click="use">Use this as my answer</button>
          <span class="muted">Read-only. Run it here, or take it into your own editor.</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* `pane` rather than `editor`: Vue's scoped CSS reaches a child component's root, and
   CodeEditor's own root is `class="editor"` - a bare `.editor` here hands a CodeMirror
   instance whatever this file says about a container. The rule LiveChat and Playground both
   document at length. */
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.tabbar { display: flex; background: var(--ice-bg-soft);
          border-bottom: 1px solid var(--ice-border); }
/* `flex: 1` each, exactly as the editors below are, so a label sits over its own pane rather
   than near it. One side alone fills the bar, which is the narrow case. */
.side { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; }
/* THE TAB IS THE TOP OF THE BOX. Split, the label and the pane under it are one bordered
   shape in two elements - top, left and right here, and the other three below - so what is
   marked is the whole of the educator's half rather than a line beside it. */
.tabbar.split .side.theirs { border: 2px solid var(--ice-drive-line); border-bottom: 0; }
.tab { font-size: 12px; padding: 9px 4px; color: var(--ice-fg-muted); background: none;
       border: 0; font-family: inherit; cursor: pointer; display: inline-flex;
       align-items: center; gap: 6px; }
.tab.active { color: var(--ice-fg); box-shadow: inset 0 -2px 0 var(--ice-primary); }
/* Live rather than remembered, said in the one place a student is already looking. */
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ice-primary);
       animation: live 1.6s ease-in-out infinite; }
@keyframes live { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }

.editors { flex: 1; min-height: 0; min-width: 0; display: flex; }
.one { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column;
       position: relative; }
/* ORANGE, AND THE SAME ORANGE AS THE CARET AND THE BAND. `--ice-drive-line` already means
   one thing on this screen - somebody else is in your session - and it was chosen precisely
   because it says "look at this" without saying "something is wrong". A second accent for
   the pane that person is typing in would read as a second thing happening.

   A BORDER RATHER THAN AN INSET SHADOW, which is what this was and why almost none of it
   could be seen: an inset shadow paints on the element's own box and the editor inside then
   paints its background straight over it, leaving the two pixels that happened to fall
   outside a child - a sliver down one edge. A border is outside the padding box, so nothing
   in the pane can cover it. `box-sizing: border-box` is global, so the pane does not grow. */
.editors.split .one.theirs { border: 2px solid var(--ice-drive-line); border-top: 0; }
/* Narrow, there is one pane on screen and the box is just it - no tab above to continue. */
.editors:not(.split) .one.theirs { border: 2px solid var(--ice-drive-line); }

.use, .ask { border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft);
             padding: 7px 12px; font-size: 12px; }
.use { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.use .muted { color: var(--ice-fg-muted); }
.link { background: none; border: 0; padding: 0; font: inherit; cursor: pointer;
        color: var(--ice-primary-strong); }
.link:hover { text-decoration: underline; }
.ask p { margin: 0 0 7px; }
.ask .acts { display: flex; gap: 8px; }
</style>
