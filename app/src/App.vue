<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { loadManifest, loadCourse } from './content.js';
import { loadAuthConfig, isEnabled, restore, startSession, signOut, session } from './auth.js';
import { load as loadProgress, mark as markProgress } from './progress.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';
import DragDropExercise from './components/DragDropExercise.vue';
import AdminPanel from './components/AdminPanel.vue';
import CourseGrid from './components/CourseGrid.vue';
import SlidesPanel from './components/SlidesPanel.vue';
import SignIn from './components/SignIn.vue';

const manifest = ref([]);
const course = ref(null);
const loading = ref(true);
const loadError = ref('');
const currentId = ref(null);
// Coding is the default; anything else declares its own player.
const componentFor = { mcq: McqExercise, dragdrop: DragDropExercise };
const badgeFor = { mcq: '?', dragdrop: '⇅' };
const needsSignIn = ref(false);
const authed = ref(false);
const showAdmin = ref(false);
const showSlides = ref(false);
/* The deck belongs to the unit the current exercise sits in, so it follows the student
 * through the unit and swaps when they cross into the next one. */
const currentTopic = computed(() =>
  topics.value.find(t => t.exercises.some(e => e.id === currentId.value)));
const unitOfCurrent = computed(() => (course.value?.modules || [])
  .flatMap(m => m.units).find(u => u.topics.some(t => t === currentTopic.value)));

// Units collapse: one flat list of every exercise in a course is unusable. The unit
// holding the current exercise opens itself, so moving through a course never needs a click
// in the sidebar.
const openUnits = ref(new Set());
const toggleUnit = u => {
  const next = new Set(openUnits.value);
  next.has(u) ? next.delete(u) : next.add(u);
  openUnits.value = next;
};
watch(unitOfCurrent, u => { if (u) openUnits.value = new Set([...openUnits.value, u.unit]); });

const doneIn = t => t.exercises.filter(e => solved.value.has(e.id)).length;
const unitDone = u => u.topics.reduce((n, t) => n + doneIn(t), 0);
const unitTotal = u => u.topics.reduce((n, t) => n + t.exercises.length, 0);

const slidesUrl = computed(() => {
  const s = currentTopic.value?.slides;
  return s ? (/^https?:\/\//.test(s) ? s : `${import.meta.env.BASE_URL}${s}`) : null;
});
const allCourses = ref([]);   // unfiltered - an admin enrols people onto courses they aren't on
const courseProgress = ref({});   // course id -> solved count, for the cards on the grid
const isAdmin = computed(() => session.admin);

/* Course > Module > Unit > Topic > exercises. Only topics hold exercises; the two levels
 * above exist to make 200-odd exercises navigable. */
const topics = computed(() =>
  (course.value?.modules || []).flatMap(m => m.units.flatMap(u => u.topics)));
const flat = computed(() => topics.value.flatMap(t => t.exercises.map(e => ({ ...e, topicId: t.topic }))));
const current = computed(() => flat.value.find(e => e.id === currentId.value));
const index = computed(() => flat.value.findIndex(e => e.id === currentId.value));
const total = computed(() => flat.value.length);

const solved = ref(new Set());
const doneCount = computed(() => flat.value.filter(e => solved.value.has(e.id)).length);

async function open(id) {
  loading.value = true; loadError.value = '';
  try {
    course.value = await loadCourse(id);
    solved.value = await loadProgress(id);
    courseProgress.value = { ...courseProgress.value, [id]: solved.value.size };
    currentId.value = flat.value[0]?.id ?? null;
    const url = new URL(location.href);
    url.searchParams.set('course', id);
    history.replaceState({}, '', url);
  } catch (e) {
    loadError.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadCourses() {
  try {
    const published = await loadManifest();
    allCourses.value = published;
    // With auth on, a student sees only what they're enrolled on.
    manifest.value = session.courses
      ? published.filter(c => session.courses.includes(c.id))
      : published;
    if (!manifest.value.length) throw new Error(session.courses
      ? 'You are not enrolled on any course yet - ask your tutor.'
      : 'No courses published - run npm run content');
    // Each card carries its own tally, so every enrolled course's progress is fetched -
    // not awaited, though: the grid is worth showing before the numbers land on it.
    for (const c of manifest.value)
      loadProgress(c.id)
        .then(s => { courseProgress.value = { ...courseProgress.value, [c.id]: s.size }; })
        .catch(() => {});
    // A course named in the URL opens straight away. That is what makes returning to the
    // tab resume where they were, rather than sending them back through the grid.
    const wanted = new URLSearchParams(location.search).get('course');
    const pick = manifest.value.find(c => c.id === wanted);
    if (pick) await open(pick.id);
    else loading.value = false;
  } catch (e) {
    loadError.value = e.message;
    loading.value = false;
  }
}

/** Back to the grid. Drops ?course= as well, or a reload would walk straight past it. */
function backToCourses() {
  course.value = null;
  currentId.value = null;
  showSlides.value = false;
  const url = new URL(location.href);
  url.searchParams.delete('course');
  history.replaceState({}, '', url);
}

/** Signed in already, or auth is switched off entirely: go straight to the content. */
onMounted(async () => {
  await loadAuthConfig();
  if (isEnabled()) {
    const token = await restore();
    if (!token) { needsSignIn.value = true; loading.value = false; return; }
    try { await startSession(token); }
    catch { needsSignIn.value = true; loading.value = false; return; }
    authed.value = true;
  }
  await loadCourses();
});

async function onAuthenticated(token) {
  needsSignIn.value = false;
  loading.value = true;
  try { await startSession(token); authed.value = true; }
  catch (e) { loadError.value = e.message; loading.value = false; return; }
  await loadCourses();
}

const markSolved = id => {
  if (solved.value.has(id)) return;
  solved.value = new Set([...solved.value, id]);
  courseProgress.value = { ...courseProgress.value, [course.value.id]: solved.value.size };
  markProgress(course.value.id, id);
};
const go = d => { const n = flat.value[index.value + d]; if (n) currentId.value = n.id; };
</script>

<template>
  <SignIn v-if="needsSignIn" @authenticated="onAuthenticated" />

  <!-- Enrolment is a whole mode of its own, not a pane of the player: it has no use for
       the exercise nav, and it has to be reachable from the grid, where there is none. -->
  <AdminPanel v-else-if="showAdmin" :courses="allCourses" @close="showAdmin = false" />

  <CourseGrid
    v-else-if="!course"
    :courses="manifest" :progress="courseProgress" :admin="isAdmin" :authed="authed"
    :loading="loading" :error="loadError"
    @open="open" @admin="showAdmin = true" @signout="signOut" />

  <div v-else class="shell">
    <aside>
      <div class="brand">
        <span class="dot"></span>
        <div>
          <strong>ICE Practice</strong>
          <small>{{ course?.title || 'Loading…' }}</small>
        </div>
      </div>

      <button class="courses" @click="backToCourses">&larr; All courses</button>

      <div class="progress" v-if="total">
        <div class="bar"><i :style="{ width: (doneCount / total * 100) + '%' }"></i></div>
        <small>{{ doneCount }} of {{ total }} complete</small>
      </div>

      <nav>
        <template v-for="m in course?.modules || []" :key="m.module">
          <h4 class="module">Module {{ m.module }} &middot; {{ m.title }}</h4>

          <template v-for="u in m.units" :key="u.unit">
            <button class="unit" :class="{ open: openUnits.has(u.unit) }" @click="toggleUnit(u.unit)">
              <span class="caret">{{ openUnits.has(u.unit) ? '▾' : '▸' }}</span>
              <span class="label">{{ u.unit }} {{ u.title }}</span>
              <span class="tally">{{ unitDone(u) }}/{{ unitTotal(u) }}</span>
            </button>

            <template v-if="openUnits.has(u.unit)">
              <template v-for="t in u.topics" :key="t.topic">
                <h5>{{ t.topic }} {{ t.title }}</h5>
                <button
                  v-for="e in t.exercises" :key="e.id"
                  class="navitem"
                  :class="{ active: e.id === currentId, done: solved.has(e.id) }"
                  @click="currentId = e.id">
                  <span class="badge">{{ solved.has(e.id) ? '✓' : (badgeFor[e.type] || 'SQL') }}</span>
                  <span class="label">{{ e.title }}</span>
                </button>
              </template>
            </template>
          </template>
        </template>
      </nav>

      <button v-if="isAdmin" class="signout" @click="showAdmin = true">Manage enrolment</button>
      <button v-if="authed" class="signout" @click="signOut">Sign out</button>
    </aside>

    <main :class="{ 'with-slides': showSlides && slidesUrl }">
      <div v-if="loadError" class="state error">
        <h2>Couldn't load the course</h2>
        <p>{{ loadError }}</p>
      </div>
      <div v-else-if="loading" class="state">
        <p>Loading…</p>
      </div>
      <component
        v-else-if="current"
        :is="componentFor[current.type] || CodingExercise"
        :key="current.id"
        :course-id="course.id"
        :exercise="current"
        :done="solved.has(current.id)"
        @solved="markSolved" />

      <footer v-if="total">
        <button class="btn ghost" :disabled="index <= 0" @click="go(-1)">Previous</button>
        <span class="muted">{{ index + 1 }} / {{ total }}</span>
        <!-- In the footer rather than inside an exercise, so every exercise type gets it. -->
        <button v-if="slidesUrl" class="btn ghost" :class="{ on: showSlides }"
                @click="showSlides = !showSlides">
          {{ showSlides ? 'Hide slides' : 'Slides' }}
        </button>
        <button class="btn ghost" :disabled="index >= total - 1" @click="go(1)">Next</button>
      </footer>
    </main>

    <SlidesPanel
      v-if="showSlides && slidesUrl"
      :src="slidesUrl" :label="currentTopic?.label"
      @close="showSlides = false" />
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 272px minmax(0, 1fr); height: 100vh; }
.shell:has(> .slides) { grid-template-columns: 272px minmax(0, 1fr) minmax(0, 38%); }
aside { background: var(--ice-bg-soft); border-right: 1px solid var(--ice-border);
        display: flex; flex-direction: column; min-height: 0; }
.brand { display: flex; gap: 10px; align-items: center; padding: 18px 18px 14px; }
.brand small { display: block; color: var(--ice-fg-muted); font-size: 11px; }
.dot { width: 12px; height: 12px; border-radius: 3px; background: var(--ice-primary); flex: none; }
.courses { margin: 0 18px 12px; padding: 6px 8px; font: inherit; font-size: 12px;
           text-align: left; cursor: pointer;
           background: var(--ice-bg); color: var(--ice-fg-muted);
           border: 1px solid var(--ice-border); border-radius: 8px; }
.courses:hover { color: var(--ice-fg); border-color: var(--ice-primary-soft); }
.progress { padding: 0 18px 14px; }
.bar { height: 4px; border-radius: 999px; background: var(--ice-bg); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ice-primary); transition: width .3s; }
.progress small { color: var(--ice-fg-muted); font-size: 11px; display: block; margin-top: 6px; }
nav { overflow: auto; padding: 6px 10px 18px; flex: 1; min-height: 0; }
h4.module { margin: 18px 8px 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
            color: var(--ice-primary-strong); }
h5 { margin: 10px 8px 4px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
     color: var(--ice-fg-muted); font-weight: 500; }
.unit { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left;
        padding: 7px 8px; border-radius: 8px; border: 0; background: none; cursor: pointer;
        color: var(--ice-fg); font: inherit; font-size: 13px; font-weight: 600; }
.unit:hover { background: var(--ice-bg); }
.caret { flex: none; width: 10px; color: var(--ice-fg-muted); font-size: 10px; }
.tally { flex: none; margin-left: auto; font-size: 10px; font-family: var(--ice-font-mono);
         color: var(--ice-fg-muted); }
.navitem { padding-left: 26px; }
.navitem { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
           padding: 7px 8px; border-radius: 8px; border: 0; background: none; cursor: pointer;
           color: var(--ice-fg-muted); font: inherit; font-size: 13px; }
.navitem:hover { background: var(--ice-bg); color: var(--ice-fg); }
.navitem.active { background: var(--ice-bg); color: var(--ice-fg); box-shadow: inset 2px 0 0 var(--ice-primary); }
.navitem.done { color: var(--ice-fg); }
.badge { flex: none; min-width: 26px; height: 20px; padding: 0 4px; border-radius: 5px;
         display: grid; place-items: center; font-size: 9px; letter-spacing: .04em;
         font-family: var(--ice-font-mono); background: var(--ice-bg); border: 1px solid var(--ice-border); }
.navitem.done .badge { background: var(--ice-primary-soft); border-color: transparent; color: var(--ice-fg); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.signout { flex: none; margin: 0; padding: 12px 18px; border: 0; border-top: 1px solid var(--ice-border);
           background: none; color: var(--ice-fg-muted); font: inherit; font-size: 12px;
           text-align: left; cursor: pointer; }
.signout:hover { color: var(--ice-fg); }

main { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
.state { display: grid; place-content: center; text-align: center; color: var(--ice-fg-muted); gap: 6px; }
.state.error h2 { color: var(--ice-fg); margin: 0; font-size: 18px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px;
         padding: 10px 16px; border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.muted { color: var(--ice-fg-muted); font-size: 12px; margin-right: auto; }
footer .btn.on { border-color: var(--ice-primary); color: var(--ice-fg); }
</style>
