<script setup>
/* Look at the data without writing a query.
 *
 * WHY THIS EXISTS AT ALL. A sandbox whose only way to see a table is to write SQL against it
 * asks the student to guess the column names first. Every other tool that ships a database
 * ships a browser beside it for exactly that reason, and here it also answers the question
 * the picker raises - "what is actually in Sport?" - without loading anything twice.
 *
 * BOTH COUNTS, ALWAYS. How many rows are in the thing, and how many match what was typed.
 * A filtered count on its own is the version of this that misleads: 12 rows reads as a small
 * table rather than as a narrow search, and the student concludes the data is thin.
 *
 * PAGED, NEVER FULLY RENDERED. `planes` is 10,660 rows and the SQL sets run to 13MB; drawing
 * a table whole would build tens of thousands of DOM rows and lock the tab. So the page is
 * fetched rather than sliced - `playground-browse.js` asks Postgres, pandas or a parsed CSV
 * for exactly the rows on screen, and only the CSV ever holds the whole thing in memory.
 *
 * THE GRID IS `DataGrid`, like every other table in the app. That is the whole point of the
 * shared renderer: a student browses `films`, queries it, and compares the two by eye, and a
 * null or a numeric column rendering differently between the two panes reads as the query
 * having changed something.
 */
import { ref, computed, watch } from 'vue';
import DataGrid from './DataGrid.vue';
import Icon from './Icon.vue';
import { page as fetchPage } from '../playground-browse.js';

const props = defineProps({
  /** The rail's entries: tables for SQL, files and frames for Python. */
  items: { type: Array, default: () => [] },
  /** Which one to open, as `kind + name`. Two-way, so the rail can drive it. */
  modelValue: String,
});
const emit = defineEmits(['update:modelValue']);

const PAGE = 100;
const keyOf = i => `${i.kind}:${i.name}`;

const at = computed({
  get: () => (props.items.some(i => keyOf(i) === props.modelValue)
    ? props.modelValue
    : (props.items[0] ? keyOf(props.items[0]) : '')),
  set: v => emit('update:modelValue', v),
});
const item = computed(() => props.items.find(i => keyOf(i) === at.value) || null);

const q = ref('');
const col = ref(null);          // an index into `columns`, or null for every column
const n = ref(0);               // which page, from zero
const data = ref(null);
const error = ref('');
const busy = ref(false);

/* Column names come back with the page rather than from the rail: a CSV's headers are only
 * known once it has been read, and a file in the rail is just a filename. So the selector
 * fills in after the first page, which is the honest order. */
const columns = computed(() => data.value?.columns || []);

/* One in flight at a time, and only the newest counts. Typing "messi" fires five searches
 * and they can finish out of order; without this the grid settles on whichever came back
 * last rather than on what is in the box. */
let token = 0;
async function refresh() {
  const it = item.value;
  if (!it) { data.value = null; return; }
  const mine = ++token;
  busy.value = true;
  try {
    const r = await fetchPage(it, { q: q.value, col: col.value, offset: n.value * PAGE, limit: PAGE });
    if (mine !== token) return;
    data.value = r;
    error.value = '';
  } catch (e) {
    if (mine !== token) return;
    data.value = null;
    error.value = String(e.message || e);
  } finally {
    if (mine === token) busy.value = false;
  }
}

/* Typing is debounced and paging is not: a keystroke is one of many and the next is 80ms
 * away, a click on page 7 is the whole intent. */
let typing = null;
watch(q, () => {
  n.value = 0;
  clearTimeout(typing);
  typing = setTimeout(refresh, 180);
});
// A different table invalidates the column filter - index 4 means something else there.
watch(at, () => { q.value = ''; col.value = null; n.value = 0; refresh(); });
watch(col, () => { n.value = 0; refresh(); });
watch(n, refresh);
/* The rail is re-read after every run, so a CREATE TABLE or a new DataFrame lands here too -
 * and so does a changed one, which is why this refetches rather than only re-selecting. */
watch(() => props.items, refresh, { deep: true, immediate: true });

const total = computed(() => data.value?.total ?? 0);
const matched = computed(() => data.value?.matched ?? 0);
const last = computed(() => Math.max(0, Math.ceil(matched.value / PAGE) - 1));

/* First, last, and a window around where you are - with a null standing for the gap. Beyond
 * about ten pages a full run of numbers is unreadable and, at 260 pages, wider than the
 * pane. */
const steps = computed(() => {
  const out = [];
  const near = i => i === 0 || i === last.value || Math.abs(i - n.value) <= 1;
  for (let i = 0; i <= last.value; i++) {
    if (near(i)) out.push(i);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
});

const num = v => v.toLocaleString();
</script>

<template>
  <div class="pgbrowse">
    <div class="bar">
      <select v-model="at" class="pick" aria-label="What to browse">
        <optgroup v-for="g in [['table','Tables'],['file','Files'],['frame','In the session']]"
                  :key="g[0]" :label="g[1]"
                  v-show="items.some(i => i.kind === g[0])">
          <option v-for="i in items.filter(i => i.kind === g[0])" :key="keyOf(i)" :value="keyOf(i)">
            {{ i.name }}
          </option>
        </optgroup>
      </select>

      <label class="find">
        <Icon name="search" :size="13" />
        <input v-model="q" type="search" placeholder="Find in this data" spellcheck="false">
      </label>

      <select v-if="columns.length" v-model="col" class="pick narrow" aria-label="Which column to search">
        <option :value="null">all columns</option>
        <option v-for="(c, i) in columns" :key="i" :value="i">{{ c }}</option>
      </select>

      <span class="sep"></span>

      <!-- Both numbers, and the filtered one is never shown alone. -->
      <span class="counts" :class="{ dim: busy }">
        <template v-if="q">{{ num(matched) }} of {{ num(total) }}</template>
        <template v-else>{{ num(total) }}</template>
        row{{ (q ? matched : total) === 1 ? '' : 's' }}
      </span>
    </div>

    <p v-if="error" class="note pad">{{ error }}</p>
    <p v-else-if="!items.length" class="note pad">
      Nothing to browse yet. Load a set from the rail and it will appear here.
    </p>
    <p v-else-if="data && !data.rows.length" class="note pad">
      <template v-if="q">Nothing in <strong>{{ item?.name }}</strong> matches “{{ q }}”.</template>
      <template v-else><strong>{{ item?.name }}</strong> is empty.</template>
    </p>
    <p v-else-if="!data" class="note pad">Reading {{ item?.name }}…</p>

    <DataGrid v-if="data && data.rows.length"
              :fields="data.fields" :rows="data.rows" :limit="PAGE"
              numbered :offset="n * PAGE" />

    <div v-if="last > 0" class="pager">
      <button :disabled="n === 0" @click="n--" aria-label="Previous page">‹</button>
      <template v-for="(s, i) in steps" :key="i">
        <span v-if="s === null" class="gap">…</span>
        <button v-else :class="{ on: s === n }" @click="n = s">{{ s + 1 }}</button>
      </template>
      <button :disabled="n === last" @click="n++" aria-label="Next page">›</button>
      <span class="of">page {{ n + 1 }} of {{ num(last + 1) }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Unique root class: Vue's scoped CSS reaches a child component's root, and this one holds
   a DataGrid and an Icon. */
/* A flex child of the tab pane, not a 100%-height block: the pane is a column flex
   container, and `height: 100%` there resolves against a parent whose height is itself
   flex-derived - which is how a grid ends up taller than the pane and scrolls the page. */
.pgbrowse { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; flex: none;
       border-bottom: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.sep { flex: 1; }

.pick { font: inherit; font-size: 12px; padding: 3px 6px; max-width: 200px;
        color: var(--ice-fg); background: var(--ice-bg);
        border: 1px solid var(--ice-border); border-radius: 6px; }
.pick.narrow { max-width: 140px; font-family: var(--ice-font-mono); font-size: 11px; }

.find { display: flex; align-items: center; gap: 5px; padding: 2px 8px;
        color: var(--ice-fg-muted); background: var(--ice-bg);
        border: 1px solid var(--ice-border); border-radius: 6px; }
.find input { width: 150px; font: inherit; font-size: 12px; padding: 2px 0;
              color: var(--ice-fg); background: none; border: 0; outline: none; }

.counts { font-family: var(--ice-font-mono); font-size: 11px; color: var(--ice-fg-muted);
          white-space: nowrap; transition: opacity .15s; }
/* Dimmed rather than replaced by a spinner: the previous count stays readable while the
   next one is being fetched, and a search that narrows from 25,979 to 1,284 does not blink
   through an empty state on the way. */
.counts.dim { opacity: .45; }

.pager { display: flex; align-items: center; gap: 3px; flex: none; padding: 5px 10px;
         border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.pager button { min-width: 24px; padding: 2px 6px; font: inherit; font-size: 11px;
                cursor: pointer; color: var(--ice-fg-muted); background: none;
                border: 1px solid transparent; border-radius: 5px; }
.pager button:hover:not(:disabled) { color: var(--ice-fg); background: var(--ice-raise); }
.pager button.on { color: var(--ice-primary-strong); border-color: var(--ice-border);
                   background: var(--ice-bg); }
.pager button:disabled { opacity: .3; cursor: default; }
.gap { color: var(--ice-fg-muted); font-size: 11px; padding: 0 2px; }
.of { margin-left: auto; font-family: var(--ice-font-mono); font-size: 11px;
      color: var(--ice-fg-muted); }

.note { color: var(--ice-fg-muted); font-size: 12.5px; line-height: 1.6; }
.pad { padding: 16px; margin: 0; }
</style>
