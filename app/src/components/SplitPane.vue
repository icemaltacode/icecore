<script setup>
/* Two panes and a divider you can drag. One component, because the Playground has three of
 * them - picker against workspace, editor against results, workspace against browser - and
 * three ad-hoc drag handlers is how they end up behaving differently from each other. Same
 * argument as `Badge.vue` and `DeckActions.vue`, stated for the third time.
 *
 * WHY DRAGGABLE AT ALL. A fixed editor height is fine for the five-line answer an exercise
 * wants and wrong for the sixty-line thing someone noodles on in a sandbox. It is also what
 * settles the browse-versus-results argument: with a divider, reference and workspace can
 * share the screen and the student picks the ratio, so neither has to win.
 *
 * SIZES ARE A PERCENTAGE, NOT PIXELS. The pane has to survive the window being resized and
 * a laptop being plugged into a monitor; a remembered 840px is most of a narrow window and
 * a sliver of a wide one. `min`/`max` are percentages for the same reason, and `minPx` is
 * the floor underneath both - a percentage cannot express "never narrower than its own
 * scrollbar".
 *
 * PERSISTED ON RELEASE, NOT ON EVERY MOVE. A drag is dozens of pointermove events and
 * localStorage is synchronous; writing per frame is a stutter you can feel in the drag
 * itself.
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue';

const props = defineProps({
  /** 'row' puts the panes side by side and the divider vertical; 'column' stacks them. */
  direction: { type: String, default: 'row' },
  /** Where the size is remembered. Omit and the pane simply forgets between visits. */
  storageKey: String,
  /** Percentage of the container given to the first pane before anyone drags it. */
  initial: { type: Number, default: 50 },
  min: { type: Number, default: 10 },
  max: { type: Number, default: 90 },
  /** Absolute floor for either pane, whatever the percentages say. */
  minPx: { type: Number, default: 120 },
  /** One pane only - the divider goes and the first pane takes everything. Lets a caller
   *  fold a three-column layout into two without unmounting anything. */
  single: Boolean,
});

const KEY = k => `ice-split-${k}`;
const clamp = v => Math.min(props.max, Math.max(props.min, v));

const stored = (() => {
  if (!props.storageKey) return null;
  const v = Number(localStorage.getItem(KEY(props.storageKey)));
  return Number.isFinite(v) && v > 0 ? clamp(v) : null;
})();

const size = ref(stored ?? clamp(props.initial));
const host = ref(null);
const dragging = ref(false);

const horizontal = computed(() => props.direction === 'row');
/* `single` has to GROW the pane, not merely stop constraining it. Leaving flex unset falls
 * back to `flex: 0 1 auto`, so the pane sizes to its own content along the split axis - and
 * a pane whose child is `flex: 1` inside a cross-axis flex column has no content width to
 * measure, so it collapses to nothing and takes the whole layout with it. That is not a
 * theoretical edge: it is what hiding the notes did to the slides. */
const style = computed(() => (props.single
  ? { flex: '1 1 auto' }
  : { flex: `0 0 ${size.value}%` }));

const remember = () => {
  if (props.storageKey) localStorage.setItem(KEY(props.storageKey), String(size.value));
};

function at(event) {
  const box = host.value?.getBoundingClientRect();
  if (!box) return;
  const span = horizontal.value ? box.width : box.height;
  if (span <= 0) return;
  const offset = horizontal.value ? event.clientX - box.left : event.clientY - box.top;
  // The pixel floor applies to BOTH panes, so a divider dragged to either end still leaves
  // something to grab it by.
  const floor = (props.minPx / span) * 100;
  size.value = Math.min(100 - floor, Math.max(floor, clamp((offset / span) * 100)));
}

/* Pointer capture, so the drag survives the pointer leaving the four-pixel handle - which
 * it does immediately, because a divider is thin and hands are not precise. Without it the
 * drag ends the moment you move fast enough to outrun it. */
function down(event) {
  event.preventDefault();
  dragging.value = true;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}
function move(event) { if (dragging.value) at(event); }
function up() {
  if (!dragging.value) return;
  dragging.value = false;
  remember();
}

/* Keyboard, because a divider is a control and `role="separator"` promises one. Also the
 * only way to move it on a machine with no pointer at all. */
function key(event) {
  const back = horizontal.value ? 'ArrowLeft' : 'ArrowUp';
  const forward = horizontal.value ? 'ArrowRight' : 'ArrowDown';
  const step = event.shiftKey ? 10 : 2;
  if (event.key === back) size.value = clamp(size.value - step);
  else if (event.key === forward) size.value = clamp(size.value + step);
  else if (event.key === 'Home') size.value = clamp(props.initial);
  else return;
  event.preventDefault();
  remember();
}

/* Double-click restores the authored ratio. The cheapest possible escape from a divider
 * dragged somewhere useless, and the convention everywhere else this control exists. */
function restore() {
  size.value = clamp(props.initial);
  remember();
}

/* While dragging, the whole window gets the divider's cursor and stops selecting text -
 * otherwise a drag across the editor highlights the code underneath it. Set on <body>
 * rather than on the pane because the pointer is captured and can be anywhere. */
const BODY = 'ice-splitting';
watch(dragging, on => {
  document.body.classList.toggle(BODY, on);
  // Inline, because the class alone cannot know which way this divider runs, and the rule
  // that forces every element to inherit it needs something to inherit FROM.
  document.body.style.cursor = on ? (horizontal.value ? 'col-resize' : 'row-resize') : '';
});
// Unmounting mid-drag - the window narrowing past the breakpoint that folds the third
// column away, say - would otherwise leave the whole page uncopyable and wearing a
// col-resize cursor with nothing left to explain it.
onBeforeUnmount(() => {
  document.body.classList.remove(BODY);
  document.body.style.cursor = '';
});
</script>

<template>
  <div ref="host" class="splitpane" :class="[direction, { dragging }]">
    <div class="pane a" :style="style"><slot name="a" /></div>
    <template v-if="!single">
      <div class="handle" role="separator" tabindex="0"
           :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
           :aria-valuenow="Math.round(size)" aria-valuemin="0" aria-valuemax="100"
           :title="'Drag to resize' + (storageKey ? ' - double-click to reset' : '')"
           @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"
           @dblclick="restore" @keydown="key">
        <i></i>
      </div>
      <div class="pane b"><slot name="b" /></div>
    </template>
  </div>
</template>

<style scoped>
/* Unique root class name. Vue's scoped CSS still reaches a child component's root, so a
   generic `.pane` or `.split` here would style whatever a slot happens to put in it. */
.splitpane { display: flex; flex: 1; min-width: 0; min-height: 0; height: 100%; width: 100%; }
.splitpane.row { flex-direction: row; }
.splitpane.column { flex-direction: column; }
.pane { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.pane.b { flex: 1 1 0; }

/* Hit area and hairline are separate: the line should read as one pixel and the target has
   to be big enough to find with a mouse. Six pixels is the smallest that does not feel
   fiddly, and the inner <i> is what you actually see. */
.handle { flex: none; position: relative; background: none; border: 0; padding: 0;
          display: grid; place-items: center; }
.splitpane.row > .handle { width: 7px; cursor: col-resize; }
.splitpane.column > .handle { height: 7px; cursor: row-resize; }
.handle i { display: block; background: var(--ice-border); transition: background .12s; }
.splitpane.row > .handle i { width: 1px; height: 100%; }
.splitpane.column > .handle i { height: 1px; width: 100%; }
.handle:hover i, .splitpane.dragging > .handle i { background: var(--ice-primary); }
.splitpane.row > .handle:hover i, .splitpane.row.dragging > .handle i { width: 3px; }
.splitpane.column > .handle:hover i, .splitpane.column.dragging > .handle i { height: 3px; }
.handle:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -1px; }
</style>
