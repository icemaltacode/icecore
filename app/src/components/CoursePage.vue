<script setup>
/* How a class is doing.
 *
 * The one question the admin area could not ask before, and the only one here a tutor
 * cannot get by asking a student. Everything else in this area is about a person; this is
 * about a group, which is why it is a section of its own rather than another filter over
 * the user list.
 *
 * COMPLETION TRAVELS BESIDE POSITION, never instead of it. `LAST#` is a bookmark, not a
 * completion flag - somebody who finished the course last month is parked on its final
 * exercise, which reads exactly like somebody stuck on it. Only the count tells those two
 * apart, so a student who has solved everything is drawn as finished and the bookmark stops
 * being the headline.
 *
 * The cohort filter is here rather than a cohort page carrying a course filter: they are
 * one fact pivoted two ways, and building both would be two screens maintaining one
 * answer. This is the pivot a tutor actually starts from - they teach a course, and the
 * intake narrows it.
 */
import { ref, computed, watch } from 'vue';
import { api } from '../auth.js';
import { loadCourse } from '../content.js';
import { walkCourse, gradable } from '../walk.js';
import CourseStalls from './CourseStalls.vue';

const props = defineProps({
  course: Object,          // the card from the catalogue
  /** The whole user listing, for cohort membership - already fetched, never re-asked. */
  users: Array,
  cohorts: Array,
});
const emit = defineEmits(['person', 'back']);

const data = ref(null);
const titles = ref({});
const loading = ref(true);
const error = ref('');
const cohort = ref('');
const sort = ref('name');
const view = ref('students');
/* The course's own index.json, kept because the stall view needs its order and its titles -
 * the API sends which exercises were solved and knows nothing about what they are called or
 * what order they come in. */
const full = ref(null);

/* The denominator comes from the catalogue, which the client has and the API does not.
 * `card.json` counts exercises; the walk is what a student actually moves through, so the
 * fallback below prefers the walk once index.json has arrived. */
const total = ref(0);

async function load() {
  loading.value = true; error.value = ''; data.value = null; titles.value = {}; full.value = null;
  total.value = props.course?.exercises || 0;
  try {
    const [d, course] = await Promise.all([
      api(`admin/users?course=${encodeURIComponent(props.course.id)}`),
      loadCourse(props.course.id).catch(() => null),
    ]);
    data.value = d;
    full.value = course;
    if (course) {
      const rows = walkCourse(course);
      titles.value = Object.fromEntries(rows.map(r => [String(r.id), r.title]));
      total.value = gradable(rows).length;
    }
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
watch(() => props.course?.id, load, { immediate: true });

const cohortOf = sub => (props.users || []).find(u => u.sub === sub)?.cohorts || [];
const cohortTitle = id => (props.cohorts || []).find(c => c.id === id)?.title || id;
const titleOf = id => titles.value[String(id)] || '';

const when = iso => (iso ? new Date(iso).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short' }) : '—');

const label = s => s.name || s.email;
/* WHICH exercises, not how many: the API sends the ids so that every tally on this screen
 * is a tally of the students actually being shown. A count could not be filtered to a
 * cohort without asking the server a second, differently-shaped question. */
const done = s => (s.solved || []).length;

const shown = computed(() => {
  const list = (data.value?.students || [])
    .filter(s => !cohort.value || cohortOf(s.sub).includes(cohort.value));
  const by = {
    name: (a, b) => label(a).localeCompare(label(b)),
    // Furthest first: the question this order answers is "who is behind", and the answer
    // is at the bottom where it can be read against the ones who are not.
    progress: (a, b) => done(b) - done(a) || label(a).localeCompare(label(b)),
    // Longest ago first, and never-started before that: this is the "who has stopped"
    // order, so an empty `last` is the most interesting value rather than the least.
    last: (a, b) => (a.last || '').localeCompare(b.last || '') || label(a).localeCompare(label(b)),
  };
  return [...list].sort(by[sort.value] || by.name);
});

/* Everyone on the course, not everyone who has started it - a class of thirty where four
 * have opened it is the thing worth seeing, and averaging over the four would hide it. */
const stats = computed(() => {
  const list = shown.value;
  if (!list.length) return null;
  return {
    people: list.length,
    started: list.filter(s => done(s) > 0).length,
    finished: list.filter(s => total.value && done(s) >= total.value).length,
    median: list.map(done).sort((a, b) => a - b)[Math.floor(list.length / 2)],
  };
});

const pct = s => (total.value ? Math.min(100, Math.round((done(s) / total.value) * 100)) : 0);
const finished = s => total.value > 0 && done(s) >= total.value;
</script>

<template>
  <section class="course">
    <button class="back link" type="button" @click="emit('back')">← All courses</button>

    <header>
      <div>
        <h2>{{ course.title }}</h2>
        <p v-if="stats" class="muted">{{ stats.people }} enrolled ·
          {{ stats.started }} started · {{ stats.finished }} finished ·
          median {{ stats.median }}<template v-if="total"> of {{ total }}</template> solved</p>
      </div>
    </header>

    <div class="tools">
      <div class="views">
        <button class="view" :class="{ on: view === 'students' }" @click="view = 'students'">Students</button>
        <button class="view" :class="{ on: view === 'stalls' }" @click="view = 'stalls'">Where they stall</button>
      </div>
      <select v-model="cohort" aria-label="Cohort">
        <option value="">Everyone on the course</option>
        <option v-for="c in cohorts" :key="c.id" :value="c.id">
          {{ c.title }}<template v-if="c.archived"> (archived)</template>
        </option>
      </select>
      <select v-if="view === 'students'" v-model="sort" aria-label="Sort">
        <option value="name">By name</option>
        <option value="progress">By progress</option>
        <option value="last">By least recently active</option>
      </select>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <!-- The same students the roster is showing, so the tallies and the rows beside them
         cannot answer two different questions. -->
    <CourseStalls v-else-if="view === 'stalls'" :course="full" :students="shown"
                  :hints="data?.hints || {}" />

    <div v-else-if="shown.length" class="tablewrap">
      <table>
        <thead>
          <tr><th>Student</th><th>Cohort</th><th>Done</th><th>XP</th><th>Where they are</th><th>Last active</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in shown" :key="s.sub" @click="emit('person', s.sub)">
            <td><strong>{{ s.name || '—' }}</strong><br><span class="addr">{{ s.email }}</span></td>
            <td>
              <span v-if="!cohortOf(s.sub).length" class="dim">—</span>
              <span v-for="c in cohortOf(s.sub)" :key="c" class="tag">{{ cohortTitle(c) }}</span>
            </td>
            <td>
              <!-- The flex box is INSIDE the cell, never the cell itself: `display: flex`
                   on a td takes it out of the table layout model, so its border-bottom is
                   drawn at the content's height rather than the row's and this one column
                   gets a rule of its own, floating above the others. -->
              <div class="bar">
                <span class="track"><span class="fill" :class="{ done: finished(s) }"
                                         :style="{ width: pct(s) + '%' }"></span></span>
                <span class="num">{{ done(s) }}<template v-if="total"> / {{ total }}</template></span>
              </div>
            </td>
            <td class="num">{{ s.xp }}</td>
            <td>
              <!-- Finished, not parked. A bookmark on the last exercise is what completing
                   a course leaves behind, and it is indistinguishable from being stuck on
                   it unless the count is allowed to speak first. -->
              <span v-if="finished(s)" class="fin">Finished</span>
              <span v-else-if="!done(s) && !s.place" class="dim">Not started</span>
              <!-- A slides bookmark resolves to its topic's title, which on its own reads
                   as an exercise they are stuck on. Slides open most topics, so this is a
                   common and entirely ordinary place to be. -->
              <span v-else-if="s.place" class="where">
                <em v-if="String(s.place.exercise).startsWith('slides:')">Slides — </em>{{
                  titleOf(s.place.exercise) || 'Exercise ' + s.place.exercise }}</span>
              <span v-else class="dim">—</span>
            </td>
            <td class="num">{{ when(s.last || s.place?.at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="muted">
      <template v-if="cohort">Nobody from that cohort is on this course.</template>
      <template v-else>Nobody is enrolled on this course yet.</template>
    </p>
  </section>
</template>

<style scoped>
.course { max-width: 980px; }
.back { display: inline-block; margin-bottom: 14px; font-size: 13px; }
header { margin-bottom: 18px; }
h2 { margin: 0 0 6px; font-size: 22px; font-weight: 500; }
.muted { color: var(--ice-fg-muted); font-size: 13px; line-height: 1.6; margin: 0; }
.err { color: var(--ice-bad); font-size: 13px; }

.tools { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; }
.views { display: flex; border: 1px solid var(--ice-border); border-radius: 8px; overflow: hidden; }
.view { font: inherit; font-size: 13px; padding: 8px 12px; background: none; border: 0;
        color: var(--ice-fg-muted); cursor: pointer; }
.view:hover { color: var(--ice-fg); }
.view.on { background: var(--ice-bg-soft); color: var(--ice-fg); }
select { font: inherit; font-size: 14px; padding: 8px 11px;
         background: var(--ice-bg); color: var(--ice-fg);
         border: 1px solid var(--ice-border); border-radius: 8px; }
select:focus { outline: none; border-color: var(--ice-primary); }

.tablewrap { overflow-x: auto; border: 1px solid var(--ice-border); border-radius: var(--ice-radius); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
     color: var(--ice-fg-muted); font-weight: 500; padding: 10px 14px;
     background: var(--ice-bg-soft); border-bottom: 1px solid var(--ice-border); white-space: nowrap; }
td { padding: 10px 14px; border-bottom: 1px solid var(--ice-border); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--ice-raise); }
td strong { font-weight: 500; }
.addr { color: var(--ice-fg-muted); font-size: 12px; }
.dim { color: var(--ice-fg-muted); }
.num { font-size: 12.5px; color: var(--ice-fg-muted); white-space: nowrap; }
.tag { display: inline-block; font-size: 11px; border: 1px solid var(--ice-border);
       background: var(--ice-bg-soft); border-radius: 5px; padding: 1px 7px; margin: 1px 4px 1px 0; }

.bar { display: flex; align-items: center; gap: 9px; min-width: 150px; }
.bar .num { flex: none; }
.track { flex: 1; height: 6px; border-radius: 3px; background: var(--ice-bg-soft);
         border: 1px solid var(--ice-border); overflow: hidden; }
.fill { display: block; height: 100%; background: var(--ice-primary); }
.fill.done { background: var(--ice-good); }
.fin { color: var(--ice-good); font-size: 13px; }
.where { font-size: 13px; }
.where em { font-style: normal; color: var(--ice-fg-muted); }
</style>
