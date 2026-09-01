<script setup>
/* The whole course structure, on demand.
 *
 * This is what used to live permanently in the sidebar. Four hundred exercises behind a
 * dozen collapsed units is a lot to give a student who only wants to know what is next, so
 * it moved here and the sidebar kept the one topic they are actually in.
 *
 * The filter is what makes the size workable: typing narrows to matching exercises and
 * opens whatever holds them, so finding "window function" is one action rather than a hunt
 * through eleven units.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import Badge from './Badge.vue';
import { walkTopic } from '../walk.js';

const props = defineProps({
  course: Object,
  currentId: String,
  solved: Object,      // Set of string ids - see progress.js, and never compare raw
  currentUnit: String,
});
const emit = defineEmits(['pick', 'close']);

const query = ref('');
const open = ref(new Set(props.currentUnit ? [props.currentUnit] : []));
const toggle = u => {
  const next = new Set(open.value);
  next.has(u) ? next.delete(u) : next.add(u);
  open.value = next;
};

const matches = e => {
  const q = query.value.trim().toLowerCase();
  return !q || e.haystack.includes(q);
};

/* Flattened once per course, with the searchable text baked in - re-lowercasing four
 * hundred titles on every keystroke is work nobody asked for.
 *
 * `rows`, not `exercises`: this is the same walk App.vue moves through, slides included, so
 * the modal and the sidebar cannot disagree about what comes next. */
const tree = computed(() => (props.course?.modules || []).map(m => ({
  ...m,
  units: m.units.map(u => ({
    ...u,
    topics: u.topics.map(t => ({
      ...t,
      rows: walkTopic(t).map(r => ({
        ...r,
        haystack: `${r.title} ${t.topic} ${t.title} ${u.unit} ${u.title}`.toLowerCase(),
      })),
    })),
  })),
})));

/* When filtering, a unit is open if it has a hit: a search that leaves everything collapsed
 * has answered nothing. */
const filtering = computed(() => !!query.value.trim());
/* A slide row survives the filter when the topic it names matches, or when anything
 * under it does - a topic heading with its exercises filtered out from under it is a
 * heading for nothing. */
const shown = computed(() => tree.value
  .map(m => ({ ...m, units: m.units
    .map(u => ({ ...u, topics: u.topics
      .map(t => ({ ...t, rows: keep(t.rows) }))
      .filter(t => t.rows.length) }))
    .filter(u => u.topics.length) }))
  .filter(m => m.units.length));

function keep(rows) {
  if (!filtering.value) return rows;
  const out = [];
  for (const r of rows) {
    if (r.kind === 'slides') { out.push(r); continue; }
    if (matches(r)) out.push(r);
  }
  // Drop a topic heading that ended up with nothing under it, unless it matched itself.
  return out.filter((r, i) =>
    r.kind !== 'slides' || matches(r) || out[i + 1]?.kind === 'exercise');
}

const isOpen = u => filtering.value || open.value.has(u.unit);
/* Tallies count exercises only - slides are taught, not graded, and a unit reading 12/20
 * when eight of the twenty are slide decks says nothing useful. */
const gradableOf = t => t.rows.filter(r => r.kind !== 'slides');
const isSolved = id => !!props.solved?.has(String(id));
const done = t => gradableOf(t).filter(e => isSolved(e.id)).length;
const unitDone = u => u.topics.reduce((n, t) => n + done(t), 0);
const unitTotal = u => u.topics.reduce((n, t) => n + gradableOf(t).length, 0);
const hits = computed(() => shown.value
  .flatMap(m => m.units.flatMap(u => u.topics.flatMap(gradableOf))).length);

const box = ref(null);
onMounted(async () => {
  await nextTick();
  // Straight to where they are, rather than to the top of a course they are 200 exercises
  // into.
  box.value?.querySelector('.entry.active')?.scrollIntoView({ block: 'center' });
});
watch(query, () => { if (box.value) box.value.scrollTop = 0; });
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="sheet" role="dialog" aria-label="Course contents">
      <header>
        <input v-model="query" class="filter" type="search" autofocus
               placeholder="Filter exercises…" @keydown.esc="query ? query = '' : emit('close')">
        <button class="btn ghost" @click="emit('close')">Close</button>
      </header>

      <p v-if="filtering" class="count">{{ hits }} match{{ hits === 1 ? '' : 'es' }}</p>

      <div ref="box" class="body">
        <template v-for="m in shown" :key="m.module">
          <h4>Module {{ m.module }} &middot; {{ m.title }}</h4>

          <section v-for="u in m.units" :key="u.unit" class="unit" :class="{ open: isOpen(u) }">
            <button class="unithead" @click="toggle(u.unit)">
              <span class="caret">{{ isOpen(u) ? '▾' : '▸' }}</span>
              <span class="label">{{ u.unit }} {{ u.title }}</span>
              <span class="tally">{{ unitDone(u) }}/{{ unitTotal(u) }}</span>
            </button>

            <div v-if="isOpen(u)" class="topics">
              <div v-for="t in u.topics" :key="t.topic" class="topic">
                <h5>{{ t.topic }} {{ t.title }}</h5>
                <button v-for="r in t.rows" :key="r.id" class="entry"
                        :class="{ active: r.id === currentId, section: r.kind === 'slides',
                                  done: r.kind !== 'slides' && isSolved(r.id) }"
                        @click="emit('pick', r.id)">
                  <Badge :row="r" :done="isSolved(r.id)" />
                  <span class="label">{{ r.title }}</span>
                </button>
              </div>
            </div>
          </section>
        </template>

        <p v-if="!shown.length" class="empty">Nothing matches “{{ query }}”.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--ice-scrim); z-index: 50;
         display: grid; place-items: center; padding: 5vh 20px; }
.sheet { width: min(680px, 100%); max-height: 100%; display: flex; flex-direction: column;
         background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
         border-radius: var(--ice-radius); overflow: hidden; }
header { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--ice-border); }
.filter { flex: 1; font: inherit; font-size: 14px; padding: 8px 11px;
          background: var(--ice-bg); color: var(--ice-fg);
          border: 1px solid var(--ice-border); border-radius: 8px; }
.filter:focus { outline: none; border-color: var(--ice-primary); }
.count { margin: 0; padding: 8px 16px 0; font-size: 11px; color: var(--ice-fg-muted);
         font-family: var(--ice-font-mono); }

.body { overflow: auto; padding: 8px 12px 18px; }
h4 { margin: 16px 8px 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
     color: var(--ice-primary-strong); }
/* Three grounds, one per level: the sheet, a unit sunk into it, and a topic lifted back
   out again. Depth rather than indentation alone - at four hundred rows an indent is not
   enough to tell you which unit you are looking at. */
.unit { background: var(--ice-bg); border: 1px solid var(--ice-border);
        border-radius: var(--ice-radius); margin: 0 0 8px; overflow: hidden; }
.unithead { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
            border: 0; background: none; cursor: pointer; font: inherit; font-size: 13px;
            font-weight: 600; padding: 10px 11px; color: var(--ice-fg); }
.unithead:hover { background: var(--ice-raise-soft); }
.caret { flex: none; width: 10px; color: var(--ice-fg-muted); font-size: 10px; }
.tally { flex: none; margin-left: auto; font-size: 10px; font-family: var(--ice-font-mono);
         color: var(--ice-fg-muted); }

.topics { padding: 0 8px 8px; }
.topic { background: var(--ice-raise); border-radius: 8px;
         padding: 4px 7px 7px; margin-top: 6px; }
h5 { margin: 6px 4px 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
     color: var(--ice-fg-muted); font-weight: 500; }

.entry { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
         border: 0; background: none; cursor: pointer; font: inherit; font-size: 13px;
         padding: 6px 6px; border-radius: 7px; color: var(--ice-fg-muted); }
.entry:hover { background: var(--ice-raise-strong); color: var(--ice-fg); }
.entry.done { color: var(--ice-fg); }
.entry.active { background: var(--ice-bg); color: var(--ice-fg);
                box-shadow: inset 2px 0 0 var(--ice-primary); }
/* Same treatment as the sidebar: a topic's slides are a heading you can also step onto. */
.entry.section { color: var(--ice-fg); font-weight: 600; margin-top: 6px; }
.entry.section:first-child { margin-top: 0; }
.entry.section .badge { background: var(--ice-primary-soft); border-color: transparent;
                        color: var(--ice-fg); }
/* Same badge as the sidebar, so an exercise looks like itself in both places. */
.badge { flex: none; min-width: 26px; height: 20px; padding: 0 4px; border-radius: 5px;
         display: grid; place-items: center; font-size: 9px; letter-spacing: .04em;
         font-family: var(--ice-font-mono); background: var(--ice-bg);
         border: 1px solid var(--ice-border); }
.entry.done .badge { background: var(--ice-primary-soft); border-color: transparent;
                     color: var(--ice-fg); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--ice-fg-muted); font-size: 13px; padding: 16px 8px; }
</style>
