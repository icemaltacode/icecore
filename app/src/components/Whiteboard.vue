<script setup>
/* THE BOARD ON SCREEN. See board.js for why it is an overlay and why it is a fixed stage.
 *
 * TWO COMPONENTS IN ONE, and the difference is not the toolbar. The educator gets a drauu
 * instance mounted on the SVG; a student gets no drauu at all - their page is rendered as
 * markup and the surface takes no pointer events. That is deliberate rather than economical:
 * a student's board is never editable, so the safest thing is for the thing that edits not to
 * exist on their screen. It also means the filter has exactly one place to be on this path.
 *
 * A LITERAL WHITE PLATE, in both themes, for the reason a matplotlib figure and an embedded
 * app get one: the ink colour is stored IN the drawing, so a surface that followed the theme
 * would show a dark-theme student black strokes on a dark board. A drawing is a picture, and
 * a picture brings its own background.
 *
 * `data-point="board"` because the pointer works here and works PERFECTLY here - the stage is
 * identical on every screen, so a fraction of it is exact rather than approximate. It is the
 * only region in the app besides a slide of which that is true.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { createDrauu } from 'drauu';
import Icon from './Icon.vue';
import { board, STAGE, current, turnTo, addPage, commitStroke, commitPage, freshBoard }
  from '../board.js';
import { clean } from '../svgclean.js';

const emit = defineEmits(['close', 'save', 'open']);

/* LITERAL, NOT TOKENS. A colour is written into the drawing and travels with it, so it has
 * to mean the same thing on a screen this file has never seen - including a saved board
 * opened months later by somebody who was not in the room. */
const INKS = ['#1f2328', '#d92d20', '#1570ef', '#099250', '#dc6803', '#6938ef'];
const SIZES = [3, 6, 14];
const TOOLS = [
  { mode: 'stylus', icon: 'edit', label: 'Pen' },
  { mode: 'line', icon: 'line', label: 'Line' },
  { mode: 'rect', icon: 'rect', label: 'Rectangle' },
  { mode: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { mode: 'eraseLine', icon: 'eraser', label: 'Erase a stroke' },
];
/* drauu's own name for the rectangle and ellipse models is not the one in its `mode`. */
const MODE = { rect: 'rectangle', ellipse: 'ellipse' };

const stage = ref(null);
const tool = ref('stylus');
const ink = ref(INKS[0]);
const size = ref(SIZES[1]);
const canUndo = ref(false);

let drauu = null;
/* The node drauu just committed, held between `committed` and the `changed` that follows it.
 * That pairing is the whole of how an append is told apart from everything else: a stroke
 * emits both, an undo, a redo, a clear and an erase emit only `changed`. */
let pending = null;
/* Set while a page is being loaded INTO the surface, because `load()` calls `clear()` and
 * `clear()` emits `changed` - so without this, opening a page writes it straight back and a
 * page turn looks like an edit. */
let loading = false;

const viewBox = `0 0 ${STAGE.w} ${STAGE.h}`;
/* A student's page, filtered. The educator's own is never passed through here: it is their
 * DOM, and filtering what somebody is drawing as they draw it would delete their stroke. */
const shown = computed(() => clean(current()));

function apply() {
  if (!drauu) return;
  loading = true;
  try { drauu.load(current()); } finally { loading = false; }
  canUndo.value = drauu.canUndo();
}

function brush() {
  if (!drauu) return;
  drauu.brush = {
    ...drauu.brush,
    mode: MODE[tool.value] || tool.value,
    color: ink.value,
    size: size.value,
    /* A shape is an outline. Filled, a rectangle drawn over a diagram hides it, and the one
     * thing a board is for is drawing ON TOP of an explanation. */
    fill: 'transparent',
  };
}

onMounted(async () => {
  if (!board.mine) return;
  await nextTick();
  drauu = createDrauu({ el: stage.value, brush: { mode: 'stylus', color: ink.value, size: size.value } });
  brush();
  drauu.on('committed', node => { pending = node || null; });
  /* `changed` also fires on pointer-down and on every move, so a page would otherwise be
   * recorded - and sent - a hundred times a stroke. `drawing` is already false by the time
   * the one that matters arrives: drauu sets it before emitting `end`. */
  drauu.on('changed', () => {
    if (loading || drauu.drawing) return;
    const svg = drauu.dump();
    if (pending) { commitStroke(pending.outerHTML, svg); pending = null; }
    else commitPage(svg);
    canUndo.value = drauu.canUndo();
  });
  apply();
});

onBeforeUnmount(() => { drauu?.unmount(); drauu = null; });

watch([tool, ink, size], brush);
/* The page the room is on, whoever turned it - and `rev`, which is how a wholesale
 * replacement announces itself. Reopening a kept board onto the page you are already on
 * changes no index, so watching the page alone would leave the surface showing the board it
 * had a moment ago. */
watch([() => board.page, () => board.rev], apply);

/* Both of these only touch drauu. What is recorded and what is sent is decided in one place
 * - the `changed` handler above - because two paths to the wire is how a board comes to
 * disagree with the one in the room. */
const undo = () => drauu?.undo();
const clearPage = () => drauu?.clear();

/* Escape closes, and only for the person who can. For everybody else the board is the lesson
 * and there is nothing to escape from - a student who dismissed it would simply be missing
 * what was being taught, with no way back to it. */
function onKey(e) {
  if (e.key === 'Escape' && board.mine) { e.preventDefault(); emit('close'); }
}
onMounted(() => addEventListener('keydown', onKey));
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <div class="whiteboard" :class="{ theirs: !board.mine }" role="dialog" aria-label="Whiteboard">
    <div class="wbstage" data-point="board">
      <!-- ONE ELEMENT, TWO LIVES. The educator's is mounted by drauu and drawn into; a
           student's is rendered from the page and takes no events. Same viewBox either way,
           which is what makes one dump the same picture on both. -->
      <svg v-if="board.mine" ref="stage" class="wbsurface" :viewBox="viewBox"
           preserveAspectRatio="xMidYMid meet"></svg>
      <svg v-else class="wbsurface" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet"
           v-html="shown"></svg>
    </div>

    <!-- The chrome is the educator's alone. A student is watching a board, not using one. -->
    <div v-if="board.mine" class="wbbar">
      <div class="wbgroup">
        <button v-for="t in TOOLS" :key="t.mode" class="wbbtn" type="button"
                :class="{ on: tool === t.mode }" :title="t.label" :aria-label="t.label"
                @click="tool = t.mode">
          <Icon :name="t.icon" :size="15" />
        </button>
      </div>

      <div class="wbgroup">
        <button v-for="c in INKS" :key="c" class="wbink" type="button"
                :class="{ on: ink === c }" :style="{ '--ink': c }" :title="`Draw in ${c}`"
                :aria-label="`Draw in ${c}`" @click="ink = c"></button>
      </div>

      <div class="wbgroup">
        <button v-for="s in SIZES" :key="s" class="wbsize" type="button"
                :class="{ on: size === s }" :title="`${s}px`" :aria-label="`${s} pixels`"
                @click="size = s"><span :style="{ '--dot': `${Math.min(s, 12)}px` }"></span></button>
      </div>

      <div class="wbgroup">
        <!-- Carrying on from something already kept. Beside undo and clear because it is the
             third thing that replaces what is on the board rather than adding to it. -->
        <!-- THE WAY OUT OF A RESUMED BOARD. Opening the whiteboard carries on from whatever
             this class already has for the topic, which is what a board in a room does; this
             is how you say you meant a blank one. It drops the identity as well as the
             pages, so what is drawn next is filed as its own document. -->
        <button v-if="board.id || board.pages.some(p => p)" class="wbbtn" type="button"
                title="Start a new board" aria-label="Start a new board"
                @click="freshBoard"><Icon name="plus" :size="15" /></button>
        <button class="wbbtn" type="button" title="Carry on from a kept board"
                aria-label="Carry on from a kept board"
                @click="emit('open')"><Icon name="attach" :size="15" /></button>
        <button class="wbbtn" type="button" :disabled="!canUndo" title="Undo" aria-label="Undo"
                @click="undo"><Icon name="undo" :size="15" /></button>
        <button class="wbbtn" type="button" title="Clear this page" aria-label="Clear this page"
                @click="clearPage"><Icon name="close" :size="15" /></button>
      </div>

      <!-- The pages, as themselves. A thumbnail of an SVG is the same SVG in a smaller box,
           so this needs no rendering of any kind. -->
      <div class="wbpages">
        <button v-for="(p, i) in board.pages" :key="i" class="wbpage" type="button"
                :class="{ on: i === board.page }" :title="`Page ${i + 1}`"
                :aria-label="`Page ${i + 1}`" @click="turnTo(i)">
          <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" v-html="clean(p)"></svg>
          <em>{{ i + 1 }}</em>
        </button>
        <button class="wbbtn" type="button" title="New page" aria-label="New page"
                @click="addPage"><Icon name="plus" :size="15" /></button>
      </div>

      <span class="wbspace"></span>

      <!-- SAID RATHER THAN SHOWN BY A DEAD BOARD. The page is still drawable and still theirs;
           what has stopped is the class seeing it, and that is not something they could work
           out from their own screen, which looks perfect. -->
      <span v-if="board.full" class="wbfull" role="status">
        This page is too big to send — start a new one.
      </span>

      <button class="btn ghost" type="button" @click="emit('save')">Save</button>
      <button class="btn" type="button" @click="emit('close')">Close</button>
    </div>
  </div>
</template>

<style scoped>
/* Unique root class, for the reason SlidesStep spells out at length: Vue's scoped CSS still
   reaches a child component's root, and a bare `.stage` or `.bar` here would land on one. */
.whiteboard { position: fixed; inset: 0; z-index: 45; display: grid;
  grid-template-rows: minmax(0, 1fr) auto; background: var(--ice-scrim); }
/* Above the panels and the top bar's menu, below every dialog and the pointer dot: a board is
   the lesson, and a confirm that opened behind it could not be answered. */

.wbstage { min-height: 0; display: grid; place-items: center; padding: 16px; }
/* THE STAGE IS LETTERBOXED THE SAME WAY ON EVERY SCREEN, the educator's included. Drawing
   into a box a student does not have is the one way a fixed stage can still go wrong. */
.wbsurface { width: 100%; height: 100%; max-width: calc((100vh - 130px) * 16 / 9);
  max-height: calc(100vw * 9 / 16); aspect-ratio: 16 / 9;
  /* Literal, in both themes - see the header. */
  background: #fff; border-radius: var(--ice-radius);
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.35); touch-action: none; }
.whiteboard.theirs .wbsurface { pointer-events: none; }

.wbbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--ice-bg); border-top: 1px solid var(--ice-border); }
.wbgroup { display: flex; align-items: center; gap: 2px; padding-right: 8px;
  border-right: 1px solid var(--ice-border); }
.wbspace { flex: 1 1 auto; }

.wbbtn { display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--ice-fg-muted);
  cursor: pointer; }
.wbbtn:hover:not(:disabled) { color: var(--ice-fg); background: var(--ice-bg-soft); }
.wbbtn:disabled { opacity: 0.4; cursor: default; }
.wbbtn.on { color: var(--ice-primary); background: var(--ice-primary-soft); }
.wbbtn:focus-visible, .wbink:focus-visible, .wbsize:focus-visible, .wbpage:focus-visible {
  outline: 2px solid var(--ice-primary); outline-offset: 1px; }

.wbink { width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer;
  background: var(--ink); border: 2px solid transparent; }
/* The ring is drawn OUTSIDE the swatch rather than as a border, so choosing a colour does not
   change the size of the thing that shows you what the colour is. */
.wbink.on { box-shadow: 0 0 0 2px var(--ice-bg), 0 0 0 4px var(--ice-primary); }

.wbsize { display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
  border: 0; border-radius: 6px; background: none; cursor: pointer; }
.wbsize:hover, .wbsize.on { background: var(--ice-bg-soft); }
.wbsize span { display: block; width: var(--dot); height: var(--dot); border-radius: 50%;
  background: var(--ice-fg-muted); }
.wbsize.on span { background: var(--ice-primary); }

.wbpages { display: flex; align-items: center; gap: 6px; overflow-x: auto; max-width: 46%; }
.wbpage { position: relative; flex: none; width: 56px; height: 32px; padding: 0;
  border: 1px solid var(--ice-border); border-radius: 4px; background: #fff;
  cursor: pointer; overflow: hidden; }
.wbpage.on { border-color: var(--ice-primary); box-shadow: 0 0 0 1px var(--ice-primary); }
.wbpage svg { width: 100%; height: 100%; display: block; }
.wbpage em { position: absolute; right: 2px; bottom: 0; font-size: 10px; font-style: normal;
  color: #667085; }

.wbfull { font-size: 12px; color: var(--ice-bad); }
</style>
