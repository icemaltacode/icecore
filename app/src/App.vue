<script setup>
import { ref, computed, onMounted } from 'vue';
import { loadManifest, loadCourse } from './content.js';
import { loadAuthConfig, isEnabled, restore, startSession, signOut, session } from './auth.js';
import { load as loadProgress, mark as markProgress } from './progress.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';
import DragDropExercise from './components/DragDropExercise.vue';
import AdminPanel from './components/AdminPanel.vue';
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
const currentUnit = computed(() =>
  (course.value?.units || []).find(u => u.exercises.some(e => e.id === currentId.value)));
const slidesUrl = computed(() => {
  const s = currentUnit.value?.slides;
  return s ? (/^https?:\/\//.test(s) ? s : `${import.meta.env.BASE_URL}${s}`) : null;
});
const allCourses = ref([]);   // unfiltered - an admin enrols people onto courses they aren't on
const isAdmin = computed(() => session.admin);

const flat = computed(() =>
  (course.value?.units || []).flatMap(u => u.exercises.map(e => ({ ...e, unitId: u.unit }))));
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
    const wanted = new URLSearchParams(location.search).get('course');
    const pick = manifest.value.find(c => c.id === wanted) || manifest.value[0];
    if (!pick) throw new Error(session.courses
      ? 'You are not enrolled on any course yet - ask your tutor.'
      : 'No courses published - run npm run content');
    await open(pick.id);
  } catch (e) {
    loadError.value = e.message;
    loading.value = false;
  }
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
  markProgress(course.value.id, id);
};
const go = d => { const n = flat.value[index.value + d]; if (n) currentId.value = n.id; };
</script>

<template>
  <SignIn v-if="needsSignIn" @authenticated="onAuthenticated" />

  <div v-else class="shell">
    <aside>
      <div class="brand">
        <span class="dot"></span>
        <div>
          <strong>ICE Practice</strong>
          <small>{{ course?.title || 'Loading…' }}</small>
        </div>
      </div>

      <select v-if="manifest.length > 1" class="courses"
              :value="course?.id" @change="open($event.target.value)">
        <option v-for="c in manifest" :key="c.id" :value="c.id">
          {{ c.topic }} &mdash; {{ c.title }}
        </option>
      </select>

      <div class="progress" v-if="total">
        <div class="bar"><i :style="{ width: (doneCount / total * 100) + '%' }"></i></div>
        <small>{{ doneCount }} of {{ total }} complete</small>
      </div>

      <nav>
        <template v-for="u in course?.units || []" :key="u.unit">
          <h4>{{ u.label }}</h4>
          <button
            v-for="e in u.exercises" :key="e.id"
            class="navitem"
            :class="{ active: e.id === currentId, done: solved.has(e.id) }"
            @click="currentId = e.id">
            <span class="badge">{{ solved.has(e.id) ? '✓' : (badgeFor[e.type] || 'SQL') }}</span>
            <span class="label">{{ e.title }}</span>
          </button>
        </template>
      </nav>

      <button v-if="isAdmin" class="signout" @click="showAdmin = !showAdmin">
        {{ showAdmin ? 'Back to practising' : 'Manage enrolment' }}
      </button>
      <button v-if="authed" class="signout" @click="signOut">Sign out</button>
    </aside>

    <main :class="{ 'with-slides': showSlides && slidesUrl && !showAdmin }">
      <AdminPanel v-if="showAdmin" :courses="allCourses" @close="showAdmin = false" />
      <div v-else-if="loadError" class="state error">
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

      <footer v-if="total && !showAdmin">
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
      v-if="showSlides && slidesUrl && !showAdmin"
      :src="slidesUrl" :label="currentUnit?.label"
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
           background: var(--ice-bg); color: var(--ice-fg);
           border: 1px solid var(--ice-border); border-radius: 8px; }
.progress { padding: 0 18px 14px; }
.bar { height: 4px; border-radius: 999px; background: var(--ice-bg); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ice-primary); transition: width .3s; }
.progress small { color: var(--ice-fg-muted); font-size: 11px; display: block; margin-top: 6px; }
nav { overflow: auto; padding: 6px 10px 18px; flex: 1; min-height: 0; }
h4 { margin: 14px 8px 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
     color: var(--ice-fg-muted); }
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
