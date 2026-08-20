<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { loadManifest, loadCourse } from './content.js';
import { loadAuthConfig, isEnabled, restore, startSession, signOut, session } from './auth.js';
import { load as loadProgress, mark as markProgress, remember } from './progress.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';
import DragDropExercise from './components/DragDropExercise.vue';
import AdminPanel from './components/AdminPanel.vue';
import CourseGrid from './components/CourseGrid.vue';
import ContentsModal from './components/ContentsModal.vue';
import TopBar from './components/TopBar.vue';
import Icon from './components/Icon.vue';
import { badgeFor } from './badges.js';
import SlidesPanel from './components/SlidesPanel.vue';
import SlidesStep from './components/SlidesStep.vue';
import { walkCourse, gradable } from './walk.js';
import SignIn from './components/SignIn.vue';

const manifest = ref([]);
const course = ref(null);
const loading = ref(true);
const loadError = ref('');
const currentId = ref(null);
// Coding is the default; anything else declares its own player.
const componentFor = { mcq: McqExercise, dragdrop: DragDropExercise };
const needsSignIn = ref(false);
const authed = ref(false);
const showAdmin = ref(false);
const showSlides = ref(false);
/* The deck belongs to the topic the current row sits in, so it follows the student through
 * the topic and swaps when they cross into the next one. Taken off the row rather than by
 * searching the exercises: a slide row is not in any topic's exercise list. */
const currentTopic = computed(() =>
  topics.value.find(t => t.topic === current.value?.topicId));
const unitOfCurrent = computed(() => (course.value?.modules || [])
  .flatMap(m => m.units).find(u => u.topics.some(t => t === currentTopic.value)));

/* The sidebar carries one topic, and the whole structure lives behind Contents. Four
 * hundred exercises in a permanent tree is not navigation, it is a wall. */
const showContents = ref(false);

/* Two states, and only one of them is remembered.
 *
 *   pinned  the permanent answer, written to storage, owned entirely by the pin. Pinned,
 *           the sidebar is a column of the layout like it always was.
 *   peek    open for now. Hovering the edge, or the rail's arrow, or a click that has not
 *           landed outside yet. Unpinned it floats over the exercise rather than taking a
 *           column, so a hover never reflows the page under the pointer.
 *
 * The delays are what make hover-to-open usable rather than a twitch: the pointer crosses
 * this edge constantly on the way to the editor, and without them the sidebar flickers
 * every time it does. Long enough to mean it, short enough not to feel stuck. */
const SIDEBAR_KEY = 'ice-sidebar-pinned';
const OPEN_AFTER = 180, CLOSE_AFTER = 250;

const pinned = ref(localStorage.getItem(SIDEBAR_KEY) === 'yes');
const peek = ref(false);
/* Set by an explicit collapse, so the pointer sitting on the rail it just uncovered does
 * not immediately open it again. Cleared by leaving the edge - the next approach is a new
 * intention. */
const dismissed = ref(false);
const sidebarOpen = computed(() => pinned.value || peek.value);

watch(pinned, v => localStorage.setItem(SIDEBAR_KEY, v ? 'yes' : 'no'));

let enterT, leaveT;
const hoverIn = () => {
  clearTimeout(leaveT);
  if (pinned.value || dismissed.value) return;
  enterT = setTimeout(() => { peek.value = true; }, OPEN_AFTER);
};
const hoverOut = () => {
  clearTimeout(enterT);
  dismissed.value = false;
  if (pinned.value) return;
  leaveT = setTimeout(() => { peek.value = false; }, CLOSE_AFTER);
};
const collapse = () => { clearTimeout(enterT); peek.value = false; dismissed.value = true; };
/* Unpinning does not slam it shut under the cursor - it just stops being permanent, and
 * the ordinary peek rules take it from there. */
const togglePin = () => {
  pinned.value = !pinned.value;
  if (!pinned.value) peek.value = true;
};

/* Covers the paths hover cannot: opened by the rail's arrow, or on a touch screen, where
 * there is no pointer to move away. */
const outside = e => {
  if (!pinned.value && peek.value && !e.target.closest('.dock')) peek.value = false;
};
onMounted(() => addEventListener('pointerdown', outside));
onBeforeUnmount(() => removeEventListener('pointerdown', outside));

const topicIndex = computed(() => topics.value.indexOf(currentTopic.value));
const goTopic = d => {
  const t = topics.value[topicIndex.value + d];
  // The first *row*, which for an interleaved topic is its opening slides rather than an
  // exercise dropped on the student with no lead-in.
  const first = flat.value.find(r => r.topicId === t?.topic);
  if (first) currentId.value = first.id;
};

const topicRows = computed(() =>
  flat.value.filter(r => r.topicId === currentTopic.value?.topic));

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
/* Every row the student walks, slides included - see walk.js. Where a topic interleaves,
 * its slides are dealt in at the section boundaries; where it doesn't, this is just its
 * exercises and everything below behaves as it always did. */
const flat = computed(() => walkCourse(course.value));
const current = computed(() => flat.value.find(e => e.id === currentId.value));
const index = computed(() => flat.value.findIndex(e => e.id === currentId.value));
const total = computed(() => flat.value.length);
/* Two different totals, deliberately. The footer counts the walk, because that is what
 * Previous and Next move through. Progress counts only what can be solved: slides are
 * taught, not graded, and a bar that fills as you page past them measures nothing. */
const exercises = computed(() => gradable(flat.value));

const solved = ref(new Set());
const doneCount = computed(() => exercises.value.filter(e => solved.value.has(e.id)).length);

async function open(id) {
  loading.value = true; loadError.value = '';
  try {
    course.value = await loadCourse(id);
    const { solved: done, last } = await loadProgress(id);
    solved.value = done;
    courseProgress.value = { ...courseProgress.value, [id]: done.size };
    // Where they left off, if that exercise still exists - content gets renumbered, and a
    // bookmark pointing at something that has been deleted should send them to the start
    // rather than nowhere.
    currentId.value = flat.value.find(e => e.id === last)?.id ?? flat.value[0]?.id ?? null;
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
        .then(({ solved: s }) => { courseProgress.value = { ...courseProgress.value, [c.id]: s.size }; })
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
  // The logo is the way home from anywhere, enrolment included - leaving that open would
  // make it look like it had done nothing.
  showAdmin.value = false;
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

/* Every move is a bookmark. Guarded on `course` because currentId is also cleared on the
 * way back to the grid, and "nowhere" is not a place to resume. */
watch(currentId, id => { if (course.value && id) remember(course.value.id, id); });
</script>

<template>
  <SignIn v-if="needsSignIn" @authenticated="onAuthenticated" />

  <div v-else class="app">
    <TopBar
      :name="session.name" :email="session.email" :admin="isAdmin" :authed="authed"
      @home="backToCourses" @admin="showAdmin = true" @signout="signOut" />

    <!-- Enrolment is a whole mode of its own, not a pane of the player: it has no use for
         the exercise nav, and it has to be reachable from the grid, where there is none. -->
    <AdminPanel v-if="showAdmin" :courses="allCourses" @close="showAdmin = false" />

    <CourseGrid
      v-else-if="!course"
      :courses="manifest" :progress="courseProgress"
      :loading="loading" :error="loadError"
      @open="open" />

    <div v-else class="shell" :class="{ railed: !pinned }">
      <!-- One hover target covering the rail and the panel that floats out of it, so
           crossing between the two is not a leave followed by a re-enter. -->
      <div class="dock" @pointerenter="hoverIn" @pointerleave="hoverOut">
        <!-- Unpinned, the sidebar leaves a rail rather than nothing: an edge you can only
             find by hovering it is one most people never find, and Contents is worth
             reaching without opening anything. -->
        <aside v-if="!pinned" class="rail">
          <button class="railbtn" title="Open the sidebar" @click="peek = true">
            <Icon name="expand" :size="16" />
          </button>
          <button class="railbtn" title="Contents" @click="showContents = true">
            <Icon name="contents" :size="16" />
          </button>
        </aside>

        <aside v-if="sidebarOpen" class="panel" :class="{ floating: !pinned }">
        <div class="brand">
          <strong>{{ course?.title || 'Loading…' }}</strong>
          <button class="pin" :class="{ on: pinned }" :aria-pressed="pinned"
                  :title="pinned ? 'Unpin the sidebar' : 'Keep the sidebar open'"
                  @click="togglePin"><Icon name="pin" :size="16" /></button>
          <button class="collapse" title="Collapse the sidebar" @click="collapse">
            <Icon name="collapse" :size="16" />
          </button>
        </div>

        <button class="courses" @click="backToCourses">&larr; All courses</button>

        <div class="progress" v-if="exercises.length">
          <div class="bar"><i :style="{ width: (doneCount / exercises.length * 100) + '%' }"></i></div>
          <small>{{ doneCount }} of {{ exercises.length }} complete</small>
        </div>

        <!-- Where they are, and the two moves either side of it. The whole structure is one
             click away in Contents; this is the part they need without asking. -->
        <div class="here" v-if="currentTopic">
          <div class="hop">
            <button class="step" :disabled="topicIndex <= 0"
                    title="Previous topic" @click="goTopic(-1)">&lsaquo;</button>
            <button class="step" :disabled="topicIndex >= topics.length - 1"
                    title="Next topic" @click="goTopic(1)">&rsaquo;</button>
          </div>
          <small>{{ unitOfCurrent?.unit }} {{ unitOfCurrent?.title }}</small>
          <strong>{{ currentTopic.topic }} {{ currentTopic.title }}</strong>
        </div>

        <button class="contents" @click="showContents = true">
          <span>Contents</span>
          <span class="hint">{{ exercises.length }} exercises</span>
        </button>

        <!-- The topic's run, slides included, in the order Next moves through it. A slide
             row is a heading you can click as well as a step: it names the run of exercises
             under it, which is the thing the sidebar never used to say. -->
        <nav>
          <button
            v-for="r in topicRows" :key="r.id"
            class="navitem"
            :class="{ active: r.id === currentId, done: r.kind !== 'slides' && solved.has(r.id),
                      section: r.kind === 'slides' }"
            @click="currentId = r.id">
            <span class="badge">{{ badgeFor(r, solved.has(r.id)) }}</span>
            <span class="label">{{ r.title }}</span>
          </button>
        </nav>
        </aside>
      </div>

      <main :class="{ 'with-slides': showSlides && slidesUrl }">
        <div v-if="loadError" class="state error">
          <h2>Couldn't load the course</h2>
          <p>{{ loadError }}</p>
        </div>
        <div v-else-if="loading" class="state">
          <p>Loading…</p>
        </div>
        <!-- Slides are a step of the run, not an exercise, so they get their own player
             rather than being squeezed through the exercise components. -->
        <SlidesStep
          v-else-if="current?.kind === 'slides'"
          :key="current.id"
          :deck="currentTopic?.slides"
          :row="current" />
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
          <!-- In the footer rather than inside an exercise, so every exercise type gets it.
               Hidden while the slides are themselves the step: offering to open the deck
               beside a full-pane copy of the same deck reads as a bug. -->
          <button v-if="slidesUrl && current?.kind !== 'slides'" class="btn ghost"
                  :class="{ on: showSlides }" @click="showSlides = !showSlides">
            {{ showSlides ? 'Hide slides' : 'Slides' }}
          </button>
          <button class="btn ghost" :disabled="index >= total - 1" @click="go(1)">Next</button>
        </footer>
      </main>

      <SlidesPanel
        v-if="showSlides && slidesUrl && current?.kind !== 'slides'"
        :src="slidesUrl" :label="currentTopic?.label"
        @close="showSlides = false" />

        <ContentsModal
          v-if="showContents"
          :course="course" :current-id="currentId" :solved="solved" :current-unit="unitOfCurrent?.unit"
          @pick="id => { currentId = id; showContents = false; }"
          @close="showContents = false" />
    </div>
  </div>
</template>

<style scoped>
/* The bar is a fixed row above whatever screen is showing, so the screen gets the rest of
   the viewport and does its own scrolling. minmax(0,·) on the row, or a long exercise
   pushes the grid taller than the window instead of scrolling inside it. */
.app { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
.shell { display: grid; grid-template-columns: 272px minmax(0, 1fr); height: 100%; min-height: 0; }
.shell:has(> .slides) { grid-template-columns: 272px minmax(0, 1fr) minmax(0, 38%); }
.shell.railed { grid-template-columns: 44px minmax(0, 1fr); }
.shell.railed:has(> .slides) { grid-template-columns: 44px minmax(0, 1fr) minmax(0, 38%); }

/* The hover target. Unpinned it is only as wide as the rail, and the panel floats out of
   it over the exercise - hovering an edge must never reflow the page under the pointer. */
.dock { position: relative; min-height: 0; display: flex; }
.dock > aside { flex: 1; min-width: 0; }
.panel.floating { position: absolute; top: 0; bottom: 0; left: 0; width: 272px; z-index: 30;
                  flex: none; box-shadow: 12px 0 32px var(--ice-scrim); }
aside { background: var(--ice-bg-soft); border-right: 1px solid var(--ice-border);
        display: flex; flex-direction: column; min-height: 0; }
.brand { display: flex; gap: 10px; align-items: center; padding: 16px 18px 12px; }
.brand strong { min-width: 0; font-size: 13px; line-height: 1.35;
                overflow: hidden; text-overflow: ellipsis; }
/* Pin upright and in the accent when it is holding the sidebar open, tilted and grey when
   it is not - it says which state it is in, not which state pressing it would reach. The
   collapse beside it only affects now, so it stays plain. */
.pin, .collapse { flex: none; background: none; border: 0; cursor: pointer; line-height: 0;
                  padding: 3px; border-radius: 6px; color: var(--ice-fg-muted); }
.pin { margin-left: auto; }
.pin:hover, .collapse:hover { background: var(--ice-raise-strong); color: var(--ice-fg); }
.pin :deep(.icon) { transform: rotate(45deg); transition: transform .12s; }
.pin.on { color: var(--ice-primary); }
.pin.on :deep(.icon) { transform: none; }

.rail { align-items: center; padding: 16px 0; gap: 8px; }
.railbtn { width: 30px; height: 30px; display: grid; place-items: center; cursor: pointer;
           background: none; border: 1px solid transparent; border-radius: 8px;
           color: var(--ice-fg-muted); font-size: 14px; line-height: 1; }
.railbtn:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }

/* Where they are. The unit is context and the topic is the heading, so the topic is the
   one that gets the weight. */
.here { padding: 4px 18px 12px; display: flex; flex-direction: column; }
.here small { color: var(--ice-fg-muted); font-size: 11px; order: 1;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.here strong { font-size: 14px; line-height: 1.35; order: 2; margin-top: 2px; }
.hop { order: 3; display: flex; gap: 4px; margin-top: 8px; }
.step { width: 26px; height: 22px; display: grid; place-items: center; cursor: pointer;
        background: var(--ice-bg); border: 1px solid var(--ice-border); border-radius: 6px;
        color: var(--ice-fg-muted); font-size: 13px; line-height: 1; }
.step:hover:not(:disabled) { color: var(--ice-fg); border-color: var(--ice-primary-soft); }
.step:disabled { opacity: .35; cursor: not-allowed; }

.contents { margin: 0 18px 10px; padding: 8px 10px; display: flex; align-items: center;
            gap: 8px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600;
            background: var(--ice-bg); color: var(--ice-fg);
            border: 1px solid var(--ice-border); border-radius: 8px; }
.contents:hover { border-color: var(--ice-primary-soft); }
.contents .hint { margin-left: auto; font-weight: 400; font-size: 10px;
                  font-family: var(--ice-font-mono); color: var(--ice-fg-muted); }
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
.navitem { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
           padding: 7px 8px; border-radius: 8px; border: 0; background: none; cursor: pointer;
           color: var(--ice-fg-muted); font: inherit; font-size: 13px; }
.navitem:hover { background: var(--ice-bg); color: var(--ice-fg); }
.navitem.active { background: var(--ice-bg); color: var(--ice-fg); box-shadow: inset 2px 0 0 var(--ice-primary); }
.navitem.done { color: var(--ice-fg); }
/* A section row is a heading first and a step second: it gets the weight and a rule above
   it, so the sidebar reads as three labelled runs rather than one undifferentiated list. */
.navitem.section { color: var(--ice-fg); font-weight: 600; margin-top: 10px; }
.navitem.section:first-child { margin-top: 0; }
.navitem.section .badge { background: var(--ice-primary-soft); border-color: transparent;
                          color: var(--ice-fg); }
.badge { flex: none; min-width: 26px; height: 20px; padding: 0 4px; border-radius: 5px;
         display: grid; place-items: center; font-size: 9px; letter-spacing: .04em;
         font-family: var(--ice-font-mono); background: var(--ice-bg); border: 1px solid var(--ice-border); }
.navitem.done .badge { background: var(--ice-primary-soft); border-color: transparent; color: var(--ice-fg); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

main { display: grid; grid-template-rows: 1fr auto; min-height: 0; }
.state { display: grid; place-content: center; text-align: center; color: var(--ice-fg-muted); gap: 6px; }
.state.error h2 { color: var(--ice-fg); margin: 0; font-size: 18px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 12px;
         padding: 10px 16px; border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.muted { color: var(--ice-fg-muted); font-size: 12px; margin-right: auto; }
footer .btn.on { border-color: var(--ice-primary); color: var(--ice-fg); }
</style>
