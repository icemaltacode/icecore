<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { loadManifest, loadCourse, loadPlayground } from './content.js';
import { loadAuthConfig, isEnabled, restore, startSession, signOut, session, api } from './auth.js';
import { progressId } from './progress.js';
import { me as mySubject, watching } from './subject.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';
import DragDropExercise from './components/DragDropExercise.vue';
import PythonExercise from './components/PythonExercise.vue';
import AdminPanel from './components/AdminPanel.vue';
import { route as appRoute, go as goAdmin, account as goAccount, watch as goWatch, leave as leaveArea } from './route.js';
import WatchBanner from './components/WatchBanner.vue';
import CourseGrid from './components/CourseGrid.vue';
import ContentsModal from './components/ContentsModal.vue';
import TopBar from './components/TopBar.vue';
import AccountPanel from './components/AccountPanel.vue';
import Icon from './components/Icon.vue';
import Badge from './components/Badge.vue';
import SlidesPanel from './components/SlidesPanel.vue';
import SlidesStep from './components/SlidesStep.vue';
import { walkCourse, gradable } from './walk.js';
import SignIn from './components/SignIn.vue';
import Playground from './components/Playground.vue';

const manifest = ref([]);
const course = ref(null);
const loading = ref(true);
const loadError = ref('');
const currentId = ref(null);
// Coding is the default; anything else declares its own player.
const componentFor = { mcq: McqExercise, dragdrop: DragDropExercise, python: PythonExercise };
/* The Playground's manifest, fetched only for a course whose card says it is one. A
 * playground has no walk at all, so it is not something index.json could carry - see
 * Playground.vue. */
const playground = ref(null);
const needsSignIn = ref(false);
const authed = ref(false);
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
 *   peek    open for now. Hovering the edge, or a click that has not landed outside yet.
 *           Unpinned it floats over the exercise rather than taking a column, so a hover
 *           never reflows the page under the pointer.
 *
 * The delays are what make hover-to-open usable rather than a twitch: the pointer crosses
 * this edge constantly on the way to the editor, and without them the sidebar flickers
 * every time it does. Long enough to mean it, short enough not to feel stuck. */
const SIDEBAR_KEY = 'ice-sidebar-pinned';
const OPEN_AFTER = 180, CLOSE_AFTER = 250;
/* Wide enough that a 272px column costs the exercise nothing it needs. Below it the rail
 * is the right default, and above it a sidebar you have to go and find is one most people
 * never find. */
const WIDE = 1000;

/* NO STORED PREFERENCE IS NOT THE SAME AS UNPINNED, which is why this reads the raw value
 * rather than comparing it: `=== 'yes'` makes a first visit and a deliberate unpin the same
 * answer, and the screen width may then override something the student actually chose. */
const remembered = localStorage.getItem(SIDEBAR_KEY);
const pinned = ref(remembered === null ? innerWidth >= WIDE : remembered === 'yes');
const peek = ref(false);
const sidebarOpen = computed(() => pinned.value || peek.value);

watch(pinned, v => localStorage.setItem(SIDEBAR_KEY, v ? 'yes' : 'no'));

let enterT, leaveT;
const hoverIn = () => {
  clearTimeout(leaveT);
  if (pinned.value) return;
  enterT = setTimeout(() => { peek.value = true; }, OPEN_AFTER);
};
const hoverOut = () => {
  clearTimeout(enterT);
  if (pinned.value) return;
  leaveT = setTimeout(() => { peek.value = false; }, CLOSE_AFTER);
};
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
  // The first *row*, which for a topic with slides is those slides rather than an
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
const courseProgress = ref({});   // course id -> { done, xp }, for the cards on the grid
const isAdmin = computed(() => session.admin);
/* The admin area is a URL, not a flag - see route.js. A route is only a request: it is
 * honoured here, once, so that a student who types `#/admin` is turned away in one place
 * rather than in every screen that reads a section name. */
const showAdmin = computed(() => isAdmin.value && appRoute.value?.area === 'admin');
/* Not gated on `isAdmin`, and that is the whole difference between this area and the other
 * two: it is everybody's. Gated on `authed` instead - on an open deployment there is no
 * account to manage, and the top bar draws no way in. */
const showAccount = computed(() => authed.value && appRoute.value?.area === 'account');

/* WHOSE progress the player is showing - see subject.js. A value rather than a flag, so
 * that reading somebody else's session and reading your own are the same code path with a
 * different subject in it, and so remote control later is a third subject rather than a
 * branch at every call site.
 *
 * Held here because this is the only component that asks about progress at all. */
const subject = ref(mySubject());
const watchingSub = computed(() =>
  (isAdmin.value && appRoute.value?.area === 'watch' ? appRoute.value.id : ''));
const watched = ref(null);   // { sub, name, email } - who the banner names

/* Course > Module > Unit > Topic > exercises. Only topics hold exercises; the two levels
 * above exist to make 200-odd exercises navigable. */
const topics = computed(() =>
  (course.value?.modules || []).flatMap(m => m.units.flatMap(u => u.topics)));
/* Every row the student walks, slides included - see walk.js. A topic with a slide range
 * opens on it and its exercises follow; where there is none, this is just its
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
/* Always through `solvedId`: the set holds strings and an exercise id is a number - see
 * progress.js. Comparing them raw reports a finished course as untouched. */
const isSolved = id => solved.value.has(progressId(id));
const doneCount = computed(() => exercises.value.filter(e => isSolved(e.id)).length);

/* XP, in the two spans a student is actually asking about: what this course has earned them
 * altogether, and what today has. Both are RECORDED rather than summed from the content -
 * see progress.js - so they arrive with the progress they belong to rather than being
 * recomputed here, and this side only keeps them moving as exercises are solved.
 *
 * The daily one is deliberately not per course: it is a fact about the student, and it is
 * fetched once a session rather than re-asked on every solve. */
const earned = ref(0);
const xpToday = ref(0);
/* What solved each exercise last time, by exercise then by step. Arrives with the course's
 * progress and is kept up to date here as things are solved, so leaving an exercise and
 * coming back inside one session shows the answer without asking the server again. */
const savedCode = ref({});

/* Solved: the way on is Next, and it says so until they take it.
 *
 * Cleared by the move itself rather than by a timer - a nudge that gives up after two
 * seconds is one a student who looked away has never seen. Held on the App rather than
 * inside an exercise because Next is the footer's button, and the exercise that earned it
 * is no longer on screen by the time it is pressed. */
const urgeNext = ref(false);
const xp = n => (n || 0).toLocaleString();

async function open(id) {
  loading.value = true; loadError.value = ''; playground.value = null;
  try {
    course.value = await loadCourse(id);
    /* A playground stops here: there is no walk to resume into, no progress to count and
     * no first exercise to land on. Fetched rather than carried inside index.json because
     * it is a different shape of thing entirely, and only a playground pays for it. */
    if (course.value.playground) {
      playground.value = await loadPlayground(id);
      const url = new URL(location.href);
      url.searchParams.set('course', id);
      history.replaceState({}, '', url);
      return;
    }
    const { solved: done, last, xp: earnedHere, code } = await subject.value.load(id);
    solved.value = done;
    earned.value = earnedHere;
    savedCode.value = code || {};
    courseProgress.value = { ...courseProgress.value, [id]: { done: done.size, xp: earnedHere } };
    /* Where they left off, if that exercise still exists - content gets renumbered, and a
     * bookmark pointing at something that has been deleted should send them to the start
     * rather than nowhere. Matched through `progressId`, because the bookmark comes back
     * from storage as a string and an exercise id is a number: compared raw it never
     * matches, and every visit silently starts from the top of the course. */
    currentId.value = flat.value.find(e => progressId(e.id) === progressId(last))?.id
      ?? flat.value[0]?.id ?? null;
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
    /* Enrolment is a per-user DynamoDB row; `open` is a property of the course. A course
     * that declares itself open is on everyone's grid without one - which is what makes the
     * Playground reachable by a student nobody remembered to enrol, and by everyone who
     * already existed before it did.
     *
     * Note what this does and does not do. The signed cookie's policy covers the whole
     * origin, so any signed-in student can already fetch any course's content by URL;
     * enrolment has only ever decided what is SHOWN. `open` changes exactly that, and
     * nothing else.
     *
     * AN ADMIN SEES EVERY COURSE, and it is DERIVED rather than enrolled. Enrolling them on
     * each course instead would be rows to write on promotion, rows to withdraw on demotion,
     * and - the part that would actually rot - rows that somebody has to remember to add for
     * every course published afterwards. It is also not something this side of the wire could
     * do: the catalogue is assembled from every card.json in the bucket, so the admin Lambda
     * does not know which courses exist, which is the same reason its listing queries per
     * user rather than per course.
     *
     * The same shape as `open`, and for the same reason: a property of who you are, resolved
     * where the catalogue is actually known, against a boundary that was only ever about what
     * is shown. Promotion takes effect on the next sign-in, with nothing to migrate. */
    manifest.value = visible(published);
    if (!manifest.value.length) throw new Error(session.courses
      ? 'You are not enrolled on any course yet - ask your educator.'
      : 'No courses published - run npm run content');
    fillProgress();
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

/* Which courses the grid shows, for whoever is being looked at.
 *
 * Watching somebody narrows it to THEIR enrolments rather than the admin's derived
 * everything: a view of a student that shows the whole catalogue is a lie about the single
 * thing the feature exists to show. `open` courses stay, because they are on everybody's
 * grid without an enrolment row - including theirs. */
const visible = (all) => {
  if (watched.value) {
    const mine = watched.value.courses || [];
    return all.filter(c => c.open || mine.includes(c.id));
  }
  return session.courses && !isAdmin.value
    ? all.filter(c => c.open || session.courses.includes(c.id))
    : all;
};

/* Every tally the grid draws, for whoever the subject currently is. Extracted because it
 * runs twice now: once on load, and again whenever the subject changes underneath it. */
function fillProgress() {
  // Not awaited: the grid is worth showing before the numbers land on it.
  for (const c of manifest.value.filter(c => !c.playground))
    subject.value.load(c.id)
      .then(({ solved: s, xp: n }) => {
        courseProgress.value = { ...courseProgress.value, [c.id]: { done: s.size, xp: n } };
      })
      .catch(() => {});
  // One question about the student rather than about any course, so it is asked here and
  // then kept up to date by markSolved rather than re-fetched.
  subject.value.earnedToday().then(n => { xpToday.value = n; }).catch(() => {});
}

/* Entering or leaving somebody else's session.
 *
 * EVERYTHING THE PREVIOUS SUBJECT ANSWERED IS DROPPED FIRST. The solved set, the XP, the
 * saved code and the open course all belong to whoever was being shown a moment ago, and
 * leaving any of it in place would draw one person's work against another's course - which
 * is the exact confusion the banner exists to prevent, arriving through the back door. */
async function switchSubject(sub) {
  course.value = null;
  playground.value = null;
  currentId.value = null;
  showSlides.value = false;
  solved.value = new Set();
  earned.value = 0;
  savedCode.value = {};
  courseProgress.value = {};
  xpToday.value = 0;
  const url = new URL(location.href);
  url.searchParams.delete('course');
  history.replaceState({}, '', url);

  if (!sub) {
    watched.value = null;
    subject.value = mySubject();
    manifest.value = visible(allCourses.value);
    fillProgress();
    return;
  }
  /* Named from the listing rather than from the URL. A banner reading `preview-3` names
   * nobody, and this screen's whole job is to say unmistakably whose session this is - so
   * the identity is fetched before the player is drawn against it. */
  subject.value = watching(sub, null);
  watched.value = { sub, name: '', email: '' };
  try {
    const who = await api(`admin/users?sub=${encodeURIComponent(sub)}`);
    watched.value = { sub, name: who.name, email: who.email, courses: who.enrolled || [] };
    subject.value = watching(sub, who);
  } catch { /* the banner falls back to the sub, which is still a banner */ }
  // The grid was filtered for whoever was being shown a moment ago.
  manifest.value = visible(allCourses.value);
  fillProgress();
}
watch(watchingSub, switchSubject);

/** Back to the grid. Drops ?course= as well, or a reload would walk straight past it. */
function backToCourses() {
  // The logo is the way home from anywhere, user management included - leaving that open
  // would make it look like it had done nothing.
  leaveArea();
  course.value = null;
  playground.value = null;
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
  /* A route nobody may follow is corrected rather than ignored, and REPLACED rather than
   * pushed: it was not a step the student took, so Back must not walk into it. After the
   * session, because `admin` is not known before it - and it covers an open deployment,
   * where there are no admins at all. */
  if (appRoute.value && appRoute.value.area !== 'account' && !isAdmin.value) leaveArea(true);
  /* The account area's own version of the same correction: signed out, or an open
   * deployment with no accounts at all. Separate rather than folded into the line above,
   * because they turn away different people for different reasons and a single condition
   * spelling both would have to be read twice to see which. */
  if (appRoute.value?.area === 'account' && !authed.value) leaveArea(true);
  /* A deep link straight into somebody's session - a reload, or a pasted URL. Before the
   * courses load rather than after: the other order fetches the admin's own progress, draws
   * it, and then replaces it, which is a flash of the wrong person's work on exactly the
   * screen that must never show one. */
  else if (watchingSub.value) await switchSubject(watchingSub.value);

  await loadCourses();
});

async function onAuthenticated(token) {
  needsSignIn.value = false;
  loading.value = true;
  try { await startSession(token); authed.value = true; }
  catch (e) { loadError.value = e.message; loading.value = false; return; }
  await loadCourses();
}

/* A solve carries the code that did it, so an exercise a student comes back to shows their
 * own answer rather than the starter.
 *
 * RE-SOLVING IS NOT EARNING AGAIN, but it is still worth keeping: someone who returns to a
 * finished exercise and improves their answer should keep the better one. So the code is
 * always recorded and the amount only on the first pass - `mark` sends no `xp` at all in
 * the second case, and the row keeps the number it already had. */
const markSolved = (id, code) => {
  const first = !isSolved(id);
  urgeNext.value = true;
  if (code) savedCode.value = { ...savedCode.value, [id]: code };

  if (!first) { subject.value.mark(course.value.id, id, { code }); return; }

  // What the exercise is worth travels with the solve, because that is what gets recorded.
  // Read off the row rather than looked up again: the walk carries the exercise's own
  // fields, and a second lookup is a second chance to disagree about which exercise it is.
  const worth = Number(flat.value.find(r => r.id === id)?.xp) || 0;
  solved.value = new Set([...solved.value, progressId(id)]);
  earned.value += worth;
  xpToday.value += worth;
  courseProgress.value = {
    ...courseProgress.value,
    [course.value.id]: { done: solved.value.size, xp: earned.value },
  };
  subject.value.mark(course.value.id, id, { xp: worth, code });
};
const go = d => { const n = flat.value[index.value + d]; if (n) currentId.value = n.id; };

/* Every move is a bookmark. Guarded on `course` because currentId is also cleared on the
 * way back to the grid, and "nowhere" is not a place to resume.
 *
 * A move is also the answer to Next's nudge, whichever way it went and however it was made
 * - the footer, the sidebar, Contents. Having gone somewhere, the student does not need to
 * be told where to go. */
watch(currentId, id => {
  urgeNext.value = false;
  if (course.value && id) subject.value.remember(course.value.id, id);
});
</script>

<template>
  <SignIn v-if="needsSignIn" @authenticated="onAuthenticated" />

  <div v-else class="app" :class="{ watching: !!watched }">
    <TopBar
      :name="session.name" :email="session.email" :admin="isAdmin" :authed="authed"
      :avatar="session.avatar"
      :xp-today="xpToday"
      :watching="!!watched"
      @home="backToCourses" @admin="goAdmin()" @account="goAccount()" @signout="signOut" />

    <!-- Above everything, always, for as long as the session is open. The screens below it
         are the ordinary player, so this band is the only thing distinguishing a student's
         work from your own. -->
    <WatchBanner v-if="watched" :name="watched.name" :email="watched.email"
                 @exit="goAdmin('people', watched.sub)" />

    <!-- User management is a whole mode of its own, not a pane of the player: it has no
         use for the exercise nav, and it has to be reachable from the grid, where there is
         none. -->
    <AdminPanel v-if="showAdmin" :courses="allCourses" @close="leaveArea()" />

    <!-- Before the grid and after the admin panel, in the same run of alternatives: it is a
         mode, not a pane. Ordered so that a student who is somehow both cannot be, rather
         than relying on the two conditions never overlapping. -->
    <AccountPanel v-else-if="showAccount" :name="session.name" :email="session.email"
                  :courses="allCourses" @reset="fillProgress()" @close="leaveArea()" />

    <CourseGrid
      v-else-if="!course"
      :courses="manifest" :progress="courseProgress"
      :loading="loading" :error="loadError"
      @open="open" />

    <!-- A playground is a course on the grid and nothing like one behind it: no modules,
         no walk, no marking. Its own screen rather than a pane of the player, for the same
         reason AdminPanel is - the exercise nav has nothing to offer it. The top bar's
         wordmark is the way back, as it is from everywhere. -->
    <Playground
      v-else-if="playground"
      :manifest="playground" :published="manifest" />

    <div v-else class="shell" :class="{ railed: !pinned }">
      <!-- One hover target covering the rail and the panel that floats out of it, so
           crossing between the two is not a leave followed by a re-enter. -->
      <div class="dock" @pointerenter="hoverIn" @pointerleave="hoverOut">
        <!-- Unpinned, the sidebar leaves a rail rather than nothing: an edge you can only
             find by hovering it is one most people never find, and Contents is worth
             reaching without opening anything.

             There is no arrow to open it and none to close it. Hovering the rail does the
             first and leaving does the second, so a button for either was a control whose
             job had already been done by the time anyone could press it. -->
        <aside v-if="!pinned" class="rail">
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
        </div>

        <button class="courses" @click="backToCourses">&larr; All courses</button>

        <div class="progress" v-if="exercises.length">
          <div class="bar"><i :style="{ width: (doneCount / exercises.length * 100) + '%' }"></i></div>
          <!-- The bar counts exercises and the figure beside it counts XP: two ways of
               saying how far in they are, and the one on the right is the one the exercises
               themselves promise. -->
          <div class="tally">
            <small>{{ doneCount }} of {{ exercises.length }} complete</small>
            <small class="xp">{{ xp(earned) }} XP</small>
          </div>
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
          <!-- The whole walk, not just the gradable part: Contents lists slides too, and a
               button promising 376 exercises that opens a list of 526 rows is counting a
               different thing from the list it opens. -->
          <span class="hint">{{ flat.length }} items</span>
        </button>

        <!-- The topic's run, slides included, in the order Next moves through it. A slide
             row is a heading you can click as well as a step: it names the run of exercises
             under it, which is the thing the sidebar never used to say. -->
        <nav>
          <button
            v-for="r in topicRows" :key="r.id"
            class="navitem"
            :class="{ active: r.id === currentId, done: r.kind !== 'slides' && isSolved(r.id),
                      section: r.kind === 'slides' }"
            @click="currentId = r.id">
            <Badge :row="r" :done="isSolved(r.id)" />
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
          :course-id="course.id"
          :note-count="currentTopic?.notes"
          :row="current" />
        <component
          v-else-if="current"
          :is="componentFor[current.type] || CodingExercise"
          :key="current.id"
          :course-id="course.id"
          :exercise="current"
          :done="isSolved(current.id)"
          :saved="savedCode[current.id]"
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
          <!-- Urging only while there is somewhere to go: a disabled button that pulses is
               asking for something it will not accept. -->
          <button class="btn ghost" :class="{ urge: urgeNext && index < total - 1 }"
                  :disabled="index >= total - 1" @click="go(1)">Next</button>
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
/* A CONDITIONAL CHILD OF A FIXED-ROW GRID NEEDS ITS OWN ROW. Two rows for the bar and the
   player; the banner is a third child, so without this it takes the `1fr` row - stretching
   to fill the whole screen - and the player is pushed into an implicit row underneath. */
.app.watching { grid-template-rows: auto auto minmax(0, 1fr); }
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
   it is not - it says which state it is in, not which state pressing it would reach. */
.pin { flex: none; margin-left: auto; background: none; border: 0; cursor: pointer;
       line-height: 0; padding: 3px; border-radius: 6px; color: var(--ice-fg-muted); }
.pin:hover { background: var(--ice-raise-strong); color: var(--ice-fg); }
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
.progress .tally { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
.progress small { color: var(--ice-fg-muted); font-size: 11px; }
.progress .xp { margin-left: auto; font-family: var(--ice-font-mono);
                color: var(--ice-primary-strong); font-weight: 600; }
nav { overflow: auto; padding: 6px 10px 18px; flex: 1; min-height: 0; }
.navitem { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left;
           padding: 7px 8px; border-radius: 8px; border: 0; background: none; cursor: pointer;
           color: var(--ice-fg-muted); font: inherit; font-size: 13px; }
.navitem:hover { background: var(--ice-bg); color: var(--ice-fg); }
.navitem.active { background: var(--ice-bg); color: var(--ice-fg); box-shadow: inset 2px 0 0 var(--ice-primary); }
.navitem.done { color: var(--ice-fg); }
/* A slides row is a heading first and a step second: it gets the weight and a rule above
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
