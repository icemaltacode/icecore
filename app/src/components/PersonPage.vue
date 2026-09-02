<script setup>
/* One person: who they are, and what they have actually done.
 *
 * The reason this screen exists at all is that the answer was already in the table and
 * nobody could read it. `progress/index.mjs` has always written the student's own source
 * onto every solved row, keyed by step, so that returning to finished work shows their
 * answer rather than a blank editor - and until now the only reader was that student. A
 * tutor reading the query somebody actually wrote, against the exercise they are actually
 * stuck on, is most of what "remote control their session" was reaching for, and it needs
 * no new writes at all. See ADMIN.md.
 *
 * SUMMARISED ACROSS EVERY COURSE THEY HAVE TOUCHED, not every course they are on. Somebody
 * unenrolled keeps their progress, and a page listing only current enrolments would report
 * a student who had done nothing.
 *
 * Titles come from the course's own `index.json`, fetched once per course opened - the same
 * static file the player reads, so an exercise is called here what it is called there. The
 * ids would technically do; "1.2.4" tells a tutor nothing about which question it was.
 */
import { ref, computed, watch } from 'vue';
import { api } from '../auth.js';
import { loadCourse } from '../content.js';
import { walkCourse } from '../walk.js';
import Icon from './Icon.vue';

const props = defineProps({
  sub: String,
  /** The row from the listing, if it has arrived - identity, not progress. */
  user: Object,
  courses: Array,
  cohorts: Array,
});
const emit = defineEmits(['edit', 'back']);

const summary = ref(null);
const error = ref('');
const loading = ref(true);

const open = ref('');            // the course id whose exercises are showing
const detail = ref(null);        // that course's solves, with the code
const titles = ref({});          // exercise id -> title, for the open course
const busy = ref(false);
const shown = ref('');           // the exercise whose code is expanded

const courseTitle = id => (props.courses || []).find(c => c.id === id)?.title || id;
const cohortTitle = id => (props.cohorts || []).find(c => c.id === id)?.title || id;

/* The denominator comes from the catalogue the client already has, never from the API -
 * the Lambda does not know which courses exist, let alone how many exercises one holds. */
const total = id => (props.courses || []).find(c => c.id === id)?.exercises || 0;

const when = iso => (iso ? new Date(iso).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

async function load() {
  loading.value = true; error.value = ''; summary.value = null;
  open.value = ''; detail.value = null;
  try { summary.value = await api(`admin/users?sub=${encodeURIComponent(props.sub)}`); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
watch(() => props.sub, load, { immediate: true });

async function openCourse(id) {
  if (open.value === id) { open.value = ''; return; }
  open.value = id; detail.value = null; shown.value = ''; busy.value = true; error.value = '';
  try {
    const [d, course] = await Promise.all([
      api(`admin/users?sub=${encodeURIComponent(props.sub)}&course=${encodeURIComponent(id)}`),
      // Best effort: a course withdrawn from the bucket still has progress rows, and the
      // list is worth drawing without its titles rather than not at all.
      loadCourse(id).catch(() => null),
    ]);
    detail.value = d;
    titles.value = course
      ? Object.fromEntries(walkCourse(course).map(r => [String(r.id), r.title]))
      : {};
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

/* An exercise id is a NUMBER in index.json and a STRING everywhere it has been stored -
 * see progress.js. One spelling here too, or every title lookup misses silently. */
const titleOf = id => titles.value[String(id)] || '';

const state = computed(() => {
  const u = props.user;
  if (!u) return null;
  if (!u.enabled) return { text: 'Suspended', tone: 'bad' };
  if (u.status === 'FORCE_CHANGE_PASSWORD') return { text: 'Invited, not signed in', tone: 'wait' };
  return { text: 'Active', tone: 'good' };
});

const steps = code => Object.entries(code || {}).sort(([a], [b]) => Number(a) - Number(b));
</script>

<template>
  <section class="person">
    <button class="back link" type="button" @click="emit('back')">← All people</button>

    <header>
      <div>
        <h2>{{ user?.name || summary?.name || '—' }}
          <span v-if="user?.admin" class="tag admin">admin</span>
        </h2>
        <p class="addr">{{ user?.email || summary?.email }}</p>
        <p v-if="state" class="meta">
          <span class="state" :class="state.tone">{{ state.text }}</span>
          <template v-if="(user?.cohorts || []).length">
            · <span v-for="c in user.cohorts" :key="c" class="tag">{{ cohortTitle(c) }}</span>
          </template>
        </p>
      </div>
      <button v-if="user" class="btn" @click="emit('edit')">Edit</button>
    </header>

    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading" class="muted">Loading…</p>

    <template v-else-if="summary">
      <p v-if="!summary.courses.length" class="muted">Nothing solved yet. Their account
        works — this is what an invitation that has been accepted and not used looks like.</p>

      <ul v-else class="courses">
        <li v-for="c in summary.courses" :key="c.course">
          <button class="row" type="button" :aria-expanded="open === c.course"
                  @click="openCourse(c.course)">
            <span class="chev" :class="{ down: open === c.course }">›</span>
            <span class="name">{{ courseTitle(c.course) }}</span>
            <span class="num">{{ c.solved }}<template v-if="total(c.course)"> / {{ total(c.course) }}</template>
              solved</span>
            <span class="num">{{ c.xp }} XP</span>
            <span class="num last">last {{ when(c.last) }}</span>
          </button>

          <div v-if="open === c.course" class="detail">
            <p v-if="busy" class="muted">Loading…</p>
            <template v-else-if="detail">
              <p v-if="detail.place" class="place">Left off at
                <code>{{ detail.place.exercise }}</code>
                <template v-if="titleOf(detail.place.exercise)"> — {{ titleOf(detail.place.exercise) }}</template>,
                {{ when(detail.place.at) }}.</p>
              <p v-if="detail.clipped" class="muted small">Too much saved work to send at
                once — the answers below stop part way rather than being cut short one by
                one.</p>

              <ul class="solves">
                <li v-for="e in detail.solved" :key="e.exercise">
                  <button class="solve" type="button"
                          :disabled="!e.code"
                          @click="shown = shown === e.exercise ? '' : e.exercise">
                    <span class="ex">{{ titleOf(e.exercise) || 'Exercise ' + e.exercise }}</span>
                    <span class="num">{{ e.xp }} XP</span>
                    <span class="num">{{ when(e.at) }}</span>
                    <span class="num code">
                      <template v-if="e.code"><Icon name="answer" :size="13" /> their answer</template>
                      <template v-else>—</template>
                    </span>
                  </button>
                  <!-- Their own source, as they left it. Read-only and plain: this is
                       evidence, not an editor. -->
                  <div v-if="shown === e.exercise && e.code" class="code">
                    <div v-for="[step, source] in steps(e.code)" :key="step">
                      <p v-if="steps(e.code).length > 1" class="step">Step {{ Number(step) + 1 }}</p>
                      <pre>{{ source }}</pre>
                    </div>
                  </div>
                </li>
                <li v-if="!detail.solved.length" class="none">Nothing solved on this course.</li>
              </ul>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.person { max-width: 860px; }
.back { display: inline-block; margin-bottom: 14px; font-size: 13px; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
         margin-bottom: 22px; }
h2 { margin: 0 0 4px; font-size: 22px; font-weight: 500; }
.addr { margin: 0; font-size: 13px; color: var(--ice-fg-muted); }
.meta { margin: 8px 0 0; font-size: 12px; color: var(--ice-fg-muted); }
.state.good { color: var(--ice-good); }
.state.wait { color: var(--ice-fg-muted); }
.state.bad { color: var(--ice-bad); }
.tag { display: inline-block; font-size: 11px; border: 1px solid var(--ice-border);
       background: var(--ice-bg-soft); border-radius: 5px; padding: 1px 7px; margin: 0 4px 0 0; }
.tag.admin { color: var(--ice-primary-strong); border-color: var(--ice-primary-soft);
             text-transform: uppercase; letter-spacing: .05em; font-size: 10px;
             vertical-align: 3px; margin-left: 6px; }
.err { color: var(--ice-bad); font-size: 13px; }
.muted { color: var(--ice-fg-muted); font-size: 13px; line-height: 1.6; max-width: 60ch; }
.muted.small { font-size: 12px; }

.courses { list-style: none; margin: 0; padding: 0;
           border: 1px solid var(--ice-border); border-radius: var(--ice-radius); overflow: hidden; }
.courses > li { border-bottom: 1px solid var(--ice-border); }
.courses > li:last-child { border-bottom: 0; }
.row { display: flex; align-items: center; gap: 14px; width: 100%; font: inherit;
       font-size: 14px; text-align: left; padding: 12px 14px; cursor: pointer;
       background: none; border: 0; color: var(--ice-fg); }
.row:hover { background: var(--ice-raise); }
.chev { color: var(--ice-fg-muted); transition: transform .12s; display: inline-block; }
.chev.down { transform: rotate(90deg); }
.name { flex: 1; font-weight: 500; }
.num { font-size: 12px; color: var(--ice-fg-muted); white-space: nowrap; }
.num.last { min-width: 9em; text-align: right; }

.detail { padding: 4px 14px 14px 34px; background: var(--ice-bg-soft); }
.place { margin: 6px 0 12px; font-size: 12.5px; color: var(--ice-fg-muted); }
.place code { font-family: var(--ice-font-mono); font-size: .92em; }
.solves { list-style: none; margin: 0; padding: 0;
          border: 1px solid var(--ice-border); border-radius: 8px;
          background: var(--ice-bg); overflow: hidden; }
.solves > li { border-bottom: 1px solid var(--ice-border); }
.solves > li:last-child { border-bottom: 0; }
.solves .none { padding: 12px 14px; color: var(--ice-fg-muted); font-size: 13px; }
.solve { display: flex; align-items: center; gap: 14px; width: 100%; font: inherit;
         font-size: 13.5px; text-align: left; padding: 9px 12px; cursor: pointer;
         background: none; border: 0; color: var(--ice-fg); }
.solve:hover:not(:disabled) { background: var(--ice-raise); }
.solve:disabled { cursor: default; }
.ex { flex: 1; }
.num.code { display: inline-flex; align-items: center; gap: 5px; min-width: 9em; }
.code { padding: 4px 12px 12px; }
.step { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
        color: var(--ice-fg-muted); }
pre { margin: 0; padding: 11px 13px; overflow-x: auto; font-family: var(--ice-font-mono);
      font-size: 12.5px; line-height: 1.55; white-space: pre; tab-size: 2;
      background: var(--ice-bg-soft); border: 1px solid var(--ice-border); border-radius: 7px; }
@media (max-width: 700px) {
  .num.last, .num.code { display: none; }
  header { flex-direction: column; }
}
</style>
