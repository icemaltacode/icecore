<script setup>
import { ref, computed, watch } from 'vue';
import { md } from '../md.js';
import { imageBase, appBase } from '../content.js';
import { check, allItems } from '../dragdrop.js';
import Icon from './Icon.vue';
import RevealNotice from './RevealNotice.vue';
import * as store from '../progress-store.js';
import { progressId } from '../progress.js';

const props = defineProps({ courseId: String, exercise: Object, done: Boolean });
const emit = defineEmits(['solved']);

// Figures and embedded apps are named bare in the markdown - a filename, an app
// directory - and this is what turns them into URLs under the course's content.
const mdx = text => md(text, {
  base: imageBase(props.courseId, props.exercise.topicId),
  apps: appBase(props.courseId, props.exercise.topicId),
});

const POOL = '__pool';

const columns = ref([]);      // [{ id, title, items }] - the pool first for classify
const verdict = ref(null);
const dragging = ref(null);   // item id being dragged
const selected = ref(null);   // item id picked by clicking, for the no-drag path
const showHint = ref(false);

const isOrder = computed(() => props.exercise.mode === 'order');

/* Shuffled, and never handed back in the answer order - that would show the answer. */
function shuffled(items) {
  if (items.length < 2) return [...items];
  const original = items.map(i => i.id).join();
  let out;
  do {
    out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
  } while (out.map(i => i.id).join() === original);
  return out;
}

function reset() {
  verdict.value = null; dragging.value = null; selected.value = null;
  columns.value = isOrder.value
    ? [{ id: POOL, title: null, items: shuffled(props.exercise.items || []) }]
    : [{ id: POOL, title: props.exercise.pool, items: shuffled(allItems(props.exercise)) },
       ...(props.exercise.zones || []).map(z => ({ id: z.id, title: z.title, items: [] }))];
}
watch(() => props.exercise.id, reset, { immediate: true });
// Separate from reset(): "Start over" clears the board, but it should not snatch away a
// hint the student is in the middle of reading.
watch(() => props.exercise.id, () => { showHint.value = false; });

const columnOf = id => columns.value.find(c => c.items.some(i => i.id === id));

/** Move an item to a column, optionally before the item currently at `beforeId`. */
function move(itemId, columnId, beforeId = null) {
  const from = columnOf(itemId);
  const to = columns.value.find(c => c.id === columnId);
  if (!from || !to || itemId === beforeId) return;
  const [item] = from.items.splice(from.items.findIndex(i => i.id === itemId), 1);
  const at = beforeId ? to.items.findIndex(i => i.id === beforeId) : to.items.length;
  to.items.splice(at === -1 ? to.items.length : at, 0, item);
  verdict.value = null;
}

// --- pointer paths: drag, and click-to-place for anyone not dragging ---------
const onDragStart = id => { dragging.value = id; selected.value = null; };
const onDragEnd = () => { dragging.value = null; };
const onDrop = (columnId, beforeId = null) => {
  if (dragging.value) move(dragging.value, columnId, beforeId);
  dragging.value = null;
};

function onClickItem(id, columnId) {
  if (selected.value === null) { selected.value = id; return; }
  if (selected.value === id) { selected.value = null; return; }
  move(selected.value, columnId, id);
  selected.value = null;
}
function onClickColumn(columnId) {
  if (selected.value === null) return;
  move(selected.value, columnId);
  selected.value = null;
}

// --- grading ---------------------------------------------------------------
function submit() {
  const response = isOrder.value
    ? columns.value[0].items.map(i => i.id)
    : Object.fromEntries(columns.value.filter(c => c.id !== POOL)
        .map(c => [c.id, c.items.map(i => i.id)]));
  verdict.value = check(props.exercise, response);
  if (verdict.value.pass) emit('solved', props.exercise.id);
}

/* SHOWING THE ANSWER FORFEITS THE EXERCISE'S XP - see CodingExercise. Different in shape
 * here only because there is no answer PANEL to toggle: revealing places the items where
 * they belong, so there is nothing to hide again afterwards, and `wantAnswer` gates the act
 * rather than a boolean. */
const asked = ref(false);
const spent = computed(() => store.revealed(props.courseId).has(progressId(props.exercise.id)));

function wantAnswer() {
  if (spent.value || !store.warnOnReveal()) { doReveal(); return; }
  asked.value = true;
}

function doReveal(quiet) {
  if (quiet) store.stopRevealWarning();
  store.reveal(props.courseId, props.exercise.id);
  asked.value = false;
  showAnswer();
}

function showAnswer() {
  columns.value = isOrder.value
    ? [{ id: POOL, title: null, items: [...(props.exercise.items || [])] }]
    : [{ id: POOL, title: props.exercise.pool, items: [] },
       ...(props.exercise.zones || []).map(z => ({ id: z.id, title: z.title, items: [...z.items] }))];
  verdict.value = null;
}
</script>

<template>
  <div class="dnd">
    <div class="card">
      <header>
        <h2>{{ exercise.title }}</h2>
        <!-- Only where there is an amount. An exercise with no `xp:` in its frontmatter
             has `exercise.xp === undefined`, which Vue interpolates as an empty string -
             so this rendered a bare "XP" against nothing. Truthiness on purpose: an
             exercise explicitly worth 0 has no badge to show either. -->
        <span v-if="exercise.xp" class="xp" :class="{ spent }"
              :title="spent ? 'The answer was shown, so this exercise no longer earns XP' : null">{{ exercise.xp }} XP</span>
      </header>

      <div class="prose" v-html="mdx(exercise.prompt)"></div>
      <div v-if="exercise.instructions" class="prose instructions" v-html="mdx(exercise.instructions)"></div>

      <div class="board" :class="{ ordered: isOrder }">
        <section
          v-for="col in columns" :key="col.id"
          class="column" :class="{ pool: col.id === POOL, target: selected !== null }"
          @dragover.prevent @drop.prevent="onDrop(col.id)" @click="onClickColumn(col.id)">
          <h3 v-if="col.title">{{ col.title }}</h3>
          <ul>
            <li
              v-for="(item, i) in col.items" :key="item.id"
              class="item"
              :class="{ dragging: dragging === item.id, selected: selected === item.id }"
              draggable="true"
              @dragstart="onDragStart(item.id)"
              @dragend="onDragEnd"
              @dragover.prevent
              @drop.stop.prevent="onDrop(col.id, item.id)"
              @click.stop="onClickItem(item.id, col.id)">
              <span v-if="isOrder" class="rank">{{ i + 1 }}</span>
              <span class="grip" aria-hidden="true">⠿</span>
              <span class="prose inline" v-html="mdx(item.content)"></span>
            </li>
          </ul>
          <p v-if="!col.items.length" class="empty">Drop items here</p>
        </section>
      </div>

      <!-- A button rather than a <details>, so a hint looks the same here as it does on
           every other exercise type. -->
      <div v-if="exercise.hint" class="hint">
        <button class="btn ghost" @click="showHint = !showHint">
          <Icon name="hint" />{{ showHint ? 'Hide hint' : 'Take a hint' }}
        </button>
        <div v-if="showHint" class="prose" v-html="mdx(exercise.hint)"></div>
      </div>

      <div class="foot">
        <p v-if="verdict" class="feedback" :class="{ pass: verdict.pass, fail: !verdict.pass }">
          {{ verdict.reason }}
        </p>
        <span v-else class="muted">Drag items, or click one and then click where it should go.</span>
        <button class="btn ghost" @click="reset">Start over</button>
        <button class="btn ghost" @click="wantAnswer"><Icon name="answer" />Show answer</button>
        <button class="btn primary" @click="submit">Check answer</button>
      </div>
      <RevealNotice v-if="asked" :xp="exercise.xp" @confirm="doReveal" @cancel="asked = false" />
    </div>
  </div>
</template>

<style scoped>
.dnd { overflow: auto; padding: 40px; display: flex; justify-content: center; }
.card { width: min(880px, 100%); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0 0 8px; font-size: 22px; }
.xp { color: var(--ice-primary-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
.xp.spent { color: var(--ice-fg-muted); text-decoration: line-through; }
.instructions { margin-top: 4px; color: var(--ice-fg); }

.board { display: grid; gap: 14px; margin: 26px 0 0;
         grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.board.ordered { grid-template-columns: minmax(0, 460px); }
.column { background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
          border-radius: var(--ice-radius); padding: 14px; min-height: 110px;
          display: flex; flex-direction: column; }
.column.target { border-style: dashed; }
.column h3 { margin: 0 0 10px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
             color: var(--ice-fg-muted); }
.column ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }

.item { display: flex; gap: 10px; align-items: center; padding: 10px 12px; cursor: grab;
        background: var(--ice-bg); border: 1px solid var(--ice-border);
        border-radius: 8px; font-size: 14px; }
.item:hover { border-color: var(--ice-primary-soft); }
.item.dragging { opacity: .4; }
.item.selected { border-color: var(--ice-primary); box-shadow: 0 0 0 1px var(--ice-primary); }
.rank { flex: none; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center;
        font-size: 11px; font-weight: 600; font-family: var(--ice-font-mono);
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border); color: var(--ice-fg-muted); }
.grip { flex: none; color: var(--ice-fg-muted); font-size: 13px; letter-spacing: -2px; }
.empty { margin: auto 0 0; padding: 6px 2px 0; color: var(--ice-fg-muted); font-size: 12px; }

.hint { margin-top: 20px; }
.hint .prose { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft);
               border-radius: var(--ice-radius); }

.foot { margin-top: 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.feedback { margin: 0 auto 0 0; font-size: 14px; }
.feedback.pass { color: var(--ice-good); }
.feedback.fail { color: var(--ice-bad); }
.muted { margin-right: auto; color: var(--ice-fg-muted); font-size: 12px; }
</style>
