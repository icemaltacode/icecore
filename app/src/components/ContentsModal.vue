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

const props = defineProps({
  course: Object,
  currentId: String,
  solved: Object,      // Set
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
 * hundred titles on every keystroke is work nobody asked for. */
const tree = computed(() => (props.course?.modules || []).map(m => ({
  ...m,
  units: m.units.map(u => ({
    ...u,
    topics: u.topics.map(t => ({
      ...t,
      exercises: t.exercises.map(e => ({
        ...e,
        haystack: `${e.title} ${t.topic} ${t.title} ${u.unit} ${u.title}`.toLowerCase(),
      })),
    })),
  })),
})));

/* When filtering, a unit is open if it has a hit: a search that leaves everything collapsed
 * has answered nothing. */
const filtering = computed(() => !!query.value.trim());
const shown = computed(() => tree.value
  .map(m => ({ ...m, units: m.units
    .map(u => ({ ...u, topics: u.topics
      .map(t => ({ ...t, exercises: t.exercises.filter(matches) }))
      .filter(t => t.exercises.length) }))
    .filter(u => u.topics.length) }))
  .filter(m => m.units.length));

const isOpen = u => filtering.value || open.value.has(u.unit);
const done = t => t.exercises.filter(e => props.solved?.has(e.id)).length;
const unitDone = u => u.topics.reduce((n, t) => n + done(t), 0);
const unitTotal = u => u.topics.reduce((n, t) => n + t.exercises.length, 0);
const hits = computed(() => shown.value.flatMap(m => m.units.flatMap(u => u.topics.flatMap(t => t.exercises))).length);

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

          <template v-for="u in m.units" :key="u.unit">
            <button class="unit" :class="{ open: isOpen(u) }" @click="toggle(u.unit)">
              <span class="caret">{{ isOpen(u) ? '▾' : '▸' }}</span>
              <span class="label">{{ u.unit }} {{ u.title }}</span>
              <span class="tally">{{ unitDone(u) }}/{{ unitTotal(u) }}</span>
            </button>

            <template v-if="isOpen(u)">
              <div v-for="t in u.topics" :key="t.topic" class="topic">
                <h5>{{ t.topic }} {{ t.title }}</h5>
                <button v-for="e in t.exercises" :key="e.id" class="entry"
                        :class="{ active: e.id === currentId, done: solved?.has(e.id) }"
                        @click="emit('pick', e.id)">
                  <span class="badge">{{ solved?.has(e.id) ? '✓' : '' }}</span>
                  <span class="label">{{ e.title }}</span>
                </button>
              </div>
            </template>
          </template>
        </template>

        <p v-if="!shown.length" class="empty">Nothing matches “{{ query }}”.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: rgba(2, 6, 16, .72); z-index: 50;
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
h5 { margin: 10px 8px 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
     color: var(--ice-fg-muted); font-weight: 500; }
.topic { margin-left: 4px; }
.unit, .entry { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
                border: 0; background: none; cursor: pointer; font: inherit;
                padding: 7px 8px; border-radius: 8px; color: var(--ice-fg); }
.unit { font-size: 13px; font-weight: 600; }
.unit:hover, .entry:hover { background: var(--ice-bg); }
.caret { flex: none; width: 10px; color: var(--ice-fg-muted); font-size: 10px; }
.tally { flex: none; margin-left: auto; font-size: 10px; font-family: var(--ice-font-mono);
         color: var(--ice-fg-muted); }
.entry { padding-left: 26px; font-size: 13px; color: var(--ice-fg-muted); }
.entry.done { color: var(--ice-fg); }
.entry.active { background: var(--ice-bg); color: var(--ice-fg);
                box-shadow: inset 2px 0 0 var(--ice-primary); }
.badge { flex: none; width: 14px; font-size: 10px; color: var(--ice-primary-strong); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--ice-fg-muted); font-size: 13px; padding: 16px 8px; }
</style>
