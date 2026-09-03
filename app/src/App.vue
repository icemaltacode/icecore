<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { loadManifest, loadCourse, loadPlayground } from './content.js';
import { loadAuthConfig, isEnabled, restore, startSession, signOut, session, api } from './auth.js';
import { progressId } from './progress.js';
import { me as mySubject, watching, driving } from './subject.js';
import CodingExercise from './components/CodingExercise.vue';
import McqExercise from './components/McqExercise.vue';
import DragDropExercise from './components/DragDropExercise.vue';
import PythonExercise from './components/PythonExercise.vue';
import AdminPanel from './components/AdminPanel.vue';
import * as store from './progress-store.js';
import { route as appRoute, go as goAdmin, account as goAccount, watch as goWatch, control as controlUrl, live as goLiveArea, leave as leaveArea } from './route.js';
import { delivery, room, sessionFor, join as joinLive, end as endLive, forget as forgetLive,
         reportActivity, reportPosition, reportMark, followedPosition, followedName,
         catchUp, wandered, marksAt, previewRows,
         control, driven, drive, takeControl, setSharing, releaseControl,
         drivingSomebody, beingDriven, sendBuffer, borrowed,
         sync, setSync, pushEditor,
         watchForSessions, stopWatchingForSessions, invitation } from './delivery.js';
import WatchBanner from './components/WatchBanner.vue';
import LiveBand from './components/LiveBand.vue';
import LivePanel from './components/LivePanel.vue';
import LiveChat from './components/LiveChat.vue';
import ControlBand from './components/ControlBand.vue';
import ControlStart from './components/ControlStart.vue';
import LiveInvite from './components/LiveInvite.vue';
import SessionSummary from './components/SessionSummary.vue';
import LiveLeave from './components/LiveLeave.vue';
import ChatToast from './components/ChatToast.vue';
import { chat, revealChat, hideToast } from './chat.js';
import { live as channel } from './live.js';
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
onBeforeUnmount(() => { removeEventListener('pointerdown', outside); stopWatchingForSessions(); });

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
/* WATCHING AND CONTROLLING SHOW THE SAME THING, so they resolve to the same subject. The
 * difference is not what is rendered but what this tab then does with it: one is read-only
 * and the other drives. Folding them here rather than at every call site is the whole point
 * of subject.js being a value. */
const watchingSub = computed(() => (isAdmin.value
  && (appRoute.value?.area === 'watch' || appRoute.value?.area === 'control')
  ? appRoute.value.id : ''));
const watched = ref(null);   // { sub, name, email } - who the banner names

/* A live session is a place, so which one you are in comes from the URL rather than from a
 * button having been pressed - a reload during a lesson lands back in the lesson, and a
 * link is how a student joins one at all. `delivery` holds what it IS; this holds where we
 * are pointed. */
const liveCohort = computed(() => (appRoute.value?.area === 'live' ? appRoute.value.id : null));
const liveError = ref('');

/* A CONTROL TAB IS ITS OWN PLACE, and it carries both halves: whose screen, and which
 * session it is happening inside. It is a tab rather than a mode of the live screen because
 * an educator needs to keep watching the class while they help one person - the panel, the
 * chat and the results are all still worth having on the other screen. */
const controlCohort = computed(() =>
  (isAdmin.value && appRoute.value?.area === 'control' ? appRoute.value.section : null));
const controlSub = computed(() =>
  (isAdmin.value && appRoute.value?.area === 'control' ? appRoute.value.id : null));
/* Who the panel is about to take control of - the sharing prompt's subject, and null when
 * it is closed. */
const takingOver = ref(null);
/* A control tab whose control has ended. It does NOT become an ordinary live tab: this
 * browser would then be reporting the educator's position from two places at once, and the
 * class would follow whichever tab moved last. So it says so and stops. */
const controlEnded = ref('');

/* WHAT THIS CLIENT IS BEING INVITED TO. Null while there is nothing, and null while we are
 * already in one - that is where they are, not somewhere to be asked to go.
 *
 * Only for students. An admin's listing is every session in the school by design, so a band
 * over the grid would announce classes they have nothing to do with; the cohort screen is
 * where an admin already sees this, and it says more. */
/* Pressed Join, and not yet in. `enterLive` fetches the session before `delivery.cohort` is
 * set, so without this the band sits there through a whole round trip with a live button on
 * it - which reads as the button having done nothing, and invites the second press that
 * cannot work. */
const joining = ref('');
const invited = computed(() =>
  (isAdmin.value || joining.value ? null : invitation()));

/**
 * Join the lesson being offered.
 *
 * IT RETRIES WHEN THE ROUTE IS ALREADY THERE. Navigating to the address you are already at
 * changes nothing, so the watcher that calls `enterLive` never fires and a second press is a
 * dead button - which is exactly what somebody does when the first press appeared to fail.
 */
function joinInvited(cohort) {
  joining.value = cohort;
  if (liveCohort.value === cohort) enterLive(cohort);
  else goLiveArea(cohort);
}
// In, or thrown out. Either way the band has no more to say.
watch(() => delivery.cohort, c => { if (c) joining.value = ''; });
watch(liveCohort, c => { if (!c) joining.value = ''; });
/* Where the tutor is, as the room reports it - which is the only way a student could know.
 * The tutor's own client reads its own position instead: it is the authority on that, and
 * asking the room where you are would be a round trip to be told what you already did. */
/* The panel owns whether it is open; the shell owns the column it sits in. It is reported
 * upwards rather than decided here because the default depends on the role and the answer
 * is remembered per browser - both of which are the panel's business, and neither of which
 * the grid should have a second opinion about. */
const panelOpen = ref(true);
const leaderAt = computed(() => (delivery.mine
  ? currentId.value
  : followedPosition()?.exercise ?? null));

/* Which slide inside a slides step, in both directions: what this client reports when it is
 * the tutor, and what it is driven to when it is following. A slides step is a range, so
 * without it a follower lands at the top of a topic the tutor is nine slides into - which
 * looks exactly like following not working. */
const mySlide = ref(null);
const followSlide = computed(() => (delivery.cohort && !delivery.mine && delivery.following
  ? followedPosition()?.slide || null
  : null));

/* HOW THE CLASS DID ON THE THING ON SCREEN. Only for the tutor, and only on a row that can
 * be answered - the Lambda already refuses to send anybody else a mark, so this is about
 * what is drawn rather than about what is known.
 *
 * Two readers, deliberately from one computed: the panel groups people by it and an MCQ
 * draws it into its own options. Two lookups would be two chances to disagree about which
 * exercise the numbers belong to, on a screen whose whole job is to answer that. */
const gradableHere = computed(() => !!current.value && current.value.kind !== 'slides');
const marksHere = computed(() => (delivery.mine && gradableHere.value
  ? marksAt(currentId.value)
  : {}));

/**
 * The class's answers to a multiple-choice question, by option index.
 *
 * Null rather than an empty tally when it does not apply, so the exercise can tell "nobody
 * has answered yet" from "this is not a live delivery" - the first is worth drawing and the
 * second must leave the exercise exactly as every student sees it.
 */
const classAnswers = computed(() => {
  if (!delivery.mine || current.value?.type !== 'mcq') return null;
  const tally = {};
  let answered = 0;
  for (const m of Object.values(marksHere.value)) {
    if (m.choice == null) continue;
    tally[m.choice] = (tally[m.choice] || 0) + 1;
    answered += 1;
  }
  return { tally, answered };
});

/* MOVING BECAUSE WE FOLLOWED IS NOT NAVIGATING. Every position this client applies from the
 * tutor also runs through the same watcher that decides somebody has struck out on their
 * own, so without a flag the first followed move would immediately stop the following. A
 * counter rather than a boolean: two applications can overlap - the row and the slide
 * arrive together - and a boolean cleared by the first would leave the second looking like
 * a student's own move. */
let applying = 0;
const applied = fn => { applying++; fn(); nextTick(() => { applying--; }); };

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

/* The educator moved. Only their moves, and only while following: everybody else's positions
 * are for the panel to draw, not for this screen to obey.
 *
 * IT WATCHES `flat` AS WELL AS THE POSITION, AND THEREFORE HAS TO LIVE BELOW IT. A watch
 * source is read the moment `watch()` is called, so with this above the declaration the whole
 * component threw `can't access lexical declaration` before it mounted - a blank site from
 * one line that reads as a dependency list. The getter it replaced was lazy and did not care
 * where it sat, which is exactly why the move was easy to miss.
 *
 * The walk is a source because of the race it exists to close: the roster can land before the
 * course has finished loading, and a position that resolves to no row is a follower that
 * never moves again. */
watch([() => followedPosition()?.exercise, flat], ([at]) => {
  if (!delivery.cohort || delivery.mine || !delivery.following || at == null) return;
  /* WHILE SOMEBODY IS DRIVING THIS SCREEN, THE DRIVE IS THE AUTHORITY. With sharing off, the
   * room still reports the educator's own tab, so following would drag the student back from
   * wherever they had just been driven - the two would take turns, once per keystroke. */
  if (beingDriven()) return;
  const row = flat.value.find(e => progressId(e.id) === progressId(at));
  if (row && row.id !== currentId.value) applied(() => { currentId.value = row.id; });
});

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
/* NULL MEANS "NOT YET KNOWN", and 0 is a real answer that has arrived.
 *
 * This was `ref(0)`, and the difference is the whole of the top bar's animation. TopBar
 * takes the FIRST value it sees as the opening balance and shows it silently - counting up
 * to a total earned yesterday would be celebrating old work. But when this started at 0 and
 * the API also said 0 - which is every student who has not earned yet today, so the common
 * case - nothing changed, the watcher never fired, and `opened` stayed false. The first
 * earn of the day was then mistaken for the opening balance and played no animation at all:
 * exactly the moment the animation exists for. */
const xpToday = ref(null);
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
    // With auth on, a student sees only what their cohorts take.
    /* Enrolment is DERIVED from the intakes somebody is in; `open` is a property of the
     * course. A course that declares itself open is on everyone's grid whatever their class
     * takes - which is what makes the Playground reachable by a student nobody remembered to
     * put in a cohort, and by everyone who already existed before it did.
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
      ? 'You are not on any course yet - ask your educator to put you in a class.'
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
 * Watching somebody narrows it to THEIR courses rather than the admin's derived everything:
 * a view of a student that shows the whole catalogue is a lie about the single thing the
 * feature exists to show. Theirs come from the intakes they are in, worked out on the other
 * side - see `getPerson`. `open` courses stay, because they are on everybody's grid whatever
 * their class takes, including theirs. */
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
  subject.value.earnedToday()
    .then(n => { xpToday.value = n; })
    // A failed fetch still has to settle the opening balance, or the first earn is silent
    // for the same reason - "unknown" is not a state the counter can stay in.
    .catch(() => { xpToday.value = xpToday.value ?? 0; });
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
  xpToday.value = null;   // unknown again until the next session answers
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
  /* WATCHING OR DRIVING, decided by which area we are in and nothing else. `driving` is
   * built from `watching`, so the reads are identical and only the writes differ - which is
   * what stops one student being rendered while another is recorded against.
   *
   * It is constructed before control has actually been claimed, and that is fine: the write
   * carries the cohort and the Lambda refuses unless this caller is the one currently driving
   * that student, so a write attempted a moment too early is turned away rather than landing
   * somewhere it should not. */
  const as = controlCohort.value
    ? who => driving(sub, who, controlCohort.value)
    : who => watching(sub, who);
  subject.value = as(null);
  watched.value = { sub, name: '', email: '' };
  try {
    const who = await api(`admin/users?sub=${encodeURIComponent(sub)}`);
    watched.value = { sub, name: who.name, email: who.email, courses: who.enrolled || [] };
    subject.value = as(who);
  } catch { /* the banner falls back to the sub, which is still a banner */ }
  // The grid was filtered for whoever was being shown a moment ago.
  manifest.value = visible(allCourses.value);
  fillProgress();
}
watch(watchingSub, switchSubject);

/**
 * Arrive in - or leave - a live session.
 *
 * The session is fetched rather than assumed, because this runs on a pasted link and a
 * reload as well as on a button: the cohort in the URL may have no session at all, and
 * landing in an empty room is worse than being told there is nothing there.
 *
 * OPENING THE COURSE IS PART OF ARRIVING. A session names one, and the whole point of the
 * screen is to be in it - a band above the grid would say a lesson was running and leave
 * the student to find it.
 */
async function enterLive(cohort, driving = false) {
  liveError.value = '';
  if (!cohort) { forgetLive(); return; }
  try {
    const { session: s, marks } = await sessionFor(cohort);
    if (!s) {
      // Replaced, not pushed: nobody chose to come here, so Back must not walk into it.
      liveError.value = 'That session has ended.';
      leaveArea(true);
      forgetLive();
      return;
    }
    joinLive(s);
    if (course.value?.id !== s.course) await open(s.course);
    /* WHERE THE CLASS LEFT OFF BEATS WHERE YOU LEFT OFF. `open()` has just resumed this
     * person's own `LAST#` marker, which is right everywhere else and wrong here: a lesson
     * opens where the lesson stopped, not where each person separately wandered to. The two
     * are indistinguishable on screen, which is exactly why this has to be deliberate.
     *
     * Through `progressId` on both sides, because a mark comes back from DynamoDB as a
     * string and an exercise id is a number - compared raw it never matches, and the lesson
     * would silently open at the top of the course every time. */
    /* WHERE THE EDUCATOR IS BEATS THE BOOKMARK, and the bookmark beats where you left off.
     *
     * Three answers to "where does this open", in that order of authority. The bookmark is
     * for the person STARTING a lesson - it is where the class got to last time. A student
     * joining one already in progress wants the room, and landing on the bookmark drops them
     * at the beginning of a lesson everyone else is twenty minutes into.
     *
     * It is read HERE rather than left to the following watcher because of the race that
     * produced the bug: `open()` loads a course over the network, and the roster often lands
     * first. The watcher then fired against an empty `flat`, found no row, and did nothing -
     * after which the educator never moved again and nothing ever corrected it. Read after
     * the course is open, the answer is simply available. */
    /* THE BOOKMARK BELONGS TO WHOEVER STARTS THE LESSON, and to nobody else.
     *
     * It records where the class got to last time, which is the right answer for an educator
     * opening or resuming one and the wrong answer for a student walking in twenty minutes
     * later. Offering it to them meant a hop to last week's position followed by a second hop
     * to the educator when the roster landed - two moves, neither of which anybody asked for.
     *
     * A joining student goes to the class if the room has already said where it is, and
     * otherwise stays exactly where they were: the roster is a second away, and standing
     * still is a better guess than last term's. */
    const at = driving ? null
      : delivery.mine ? marks?.[s.course]?.exercise
        : followedPosition()?.exercise ?? null;
    if (at != null) {
      const row = flat.value.find(e => progressId(e.id) === progressId(at));
      /* THROUGH `applied`, because arriving somewhere is not striking out on your own.
       * Without it, joining a lesson being taught anywhere other than where you happened to
       * be left the student immediately told they had stopped following - on the strength of
       * a move the app had just made for them. */
      if (row) applied(() => { currentId.value = row.id; });
    }

    /* A CONTROL TAB REPORTS NOTHING AND OPENS NOWHERE IN PARTICULAR.
     *
     * Not reporting is the load-bearing half. An educator with a control tab open has TWO
     * connections in the room under one sub, and if both said where they were, the room's
     * idea of where the educator is would flap between them - so the whole class would
     * follow whichever of the educator's tabs moved last. This tab is driving somebody
     * else's screen; it is not anywhere itself.
     *
     * And it opens on the STUDENT, not on the class's bookmark: the point of taking control
     * is to see what they are seeing, and landing on the lesson's bookmark would silently
     * drag them off whatever they were stuck on the moment control began. That position
     * arrives with the roster rather than now, so it is applied by a watcher.
     *
     * Control itself is claimed when the SOCKET opens, not here: `joinLive` has only just
     * asked for a ticket, so a `control` sent now goes nowhere at all - `send` drops
     * silently when there is nothing to send on, which is right for a channel and would
     * have made this the one call that never happened. */
    if (driving) return;
    /* Where we are travels with "still here", because the two facts arrive together and a
     * second message for the position would be a second thing to keep in step. A callback
     * rather than a value: delivery.js has no business watching the player's state, and the
     * player already knows. */
    reportActivity(() => (current.value
      ? { at: current.value.id, title: current.value.title, slide: mySlide.value }
      : null));
  } catch (e) {
    /* SAY SOMETHING, ALWAYS. `e.message` is empty for more errors than it looks - a bare
     * `throw new Error()`, a rejection with no reason, anything whose message never got set -
     * and `.livegone` renders on truthiness, so an empty one took the whole session off the
     * screen without a word on it. A lesson vanishing in silence is the worst version of
     * every failure this can have.
     *
     * The console gets the error ITSELF, not its message: a stack is the only thing that says
     * where an unmessaged error came from, and swallowing it cost a long afternoon. */
    console.error('live: could not enter', cohort, e);
    liveError.value = e?.message || 'That session could not be opened. Try joining again.';
    leaveArea(true);
    forgetLive();
  }
}
watch(liveCohort, c => enterLive(c));

/* The control tab, arriving. Same session, same channel, different job - so it goes through
 * the same door with `driving` set rather than through a second one that would have to be
 * kept in step with this one. */
watch(controlCohort, c => { controlEnded.value = ''; enterLive(c, true); });

/* CLAIMED WHEN THE SOCKET OPENS, and again after every reconnection. Re-taking your own
 * control is idempotent by construction - the conditional write allows it when `by` is
 * already you - so a tunnel or API Gateway's two-hour cap restores the claim rather than
 * dropping the educator into a tab that looks like it is driving and is not. */
watch(() => channel.status, st => {
  if (st !== 'open' || !controlSub.value || controlEnded.value) return;
  if (control.sub === controlSub.value && control.by === session.sub) return;
  takeControl(controlSub.value, false);
});

/* ONCE, when the room first says where they are. A control tab opens on the student, and
 * their position is not known until the roster lands - so this is a watcher rather than a
 * line in `enterLive`, and it stops the moment it has done its job or the educator would be
 * dragged back to the student every time the student moved.
 *
 * Applied, so it is not mistaken for the educator striking out on their own. */
const landed = ref(false);
watch(() => (controlSub.value ? room.here[controlSub.value]?.position?.exercise : null), at => {
  if (!controlSub.value || landed.value || at == null) return;
  const row = flat.value.find(e => progressId(e.id) === progressId(at));
  if (!row) return;
  landed.value = true;
  applied(() => { currentId.value = row.id; });
});
watch(controlSub, () => { landed.value = false; });

/* BEING DRIVEN. The instruction rather than the destination - `at` changes on every drive,
 * including one back to where the screen already is, and watching the position would drop
 * the second of two drives to the same row. That is what paging back and forth in a deck
 * looks like.
 *
 * Through `applied` for the same reason a followed move is: this is not the student
 * navigating, and treating it as one would end their following on the first drive. */
watch(() => driven.at, () => {
  if (!beingDriven()) return;
  const at = driven.position?.exercise;
  if (at == null) return;
  const row = flat.value.find(e => progressId(e.id) === progressId(at));
  if (row && row.id !== currentId.value) applied(() => { currentId.value = row.id; });
  if (driven.position?.slide != null) applied(() => { mySlide.value = driven.position.slide; });
});

/* Control ending, from either side. The educator's tab says so and stops rather than
 * quietly becoming a second live tab - see `controlEnded`. */
watch(() => control.sub, (now_, was) => {
  if (!controlSub.value) return;
  if (was && !now_) controlEnded.value = 'Control has ended.';
});

/* The prompt's answer, held until the new tab has actually taken control - `sharing` is a
 * field on the control row and there is no row to set it on until then. */
const pendingShare = ref('');
watch(() => control.sub, sub => {
  if (sub && sub === pendingShare.value) { setSharing(true); pendingShare.value = ''; }
});

/** Open a tab that drives one student's screen. */
function startControl(sharing) {
  const who = takingOver.value;
  takingOver.value = null;
  if (!who || !delivery.cohort) return;
  /* A TAB, as the brief asks, and the reason is that the live screen is still worth
   * watching: the panel, the chat and the class's answers are all on it, and an educator
   * helping one person has not stopped running the lesson. `sharing` travels in the URL's
   * absence - the new tab takes control itself, and then this one sets the flag, so the
   * choice made in the prompt is applied by the tab that made it. */
  window.open(location.pathname + location.search + controlUrl(delivery.cohort, who.sub),
              '_blank', 'noopener');
  if (sharing) pendingShare.value = who.sub;
}

/* ---- the editor, across the channel --------------------------------------
 *
 * ONE FIELD IN EACH DIRECTION AND NO MERGE. While control is on, the student's editor is
 * read-only and the educator's is the live one - two people typing into one buffer is not
 * something this can do, and a half-built merge is worse than the rule.
 */

/** What this client currently has in its editor, from whichever exercise is on screen. */
const myCode = ref('');
/** And where its caret is, so the other end can see somebody in the room. */
const myCursor = ref(null);
/* WHICH EXERCISE `myCode` BELONGS TO, and it is load-bearing rather than bookkeeping. The
 * emit that fills it is debounced, and an exercise whose starter code is empty never emits
 * at all - so on a fresh row this ref still holds the PREVIOUS one's text for a moment or
 * for good. Everything that stashes it has to know that, or it stashes the wrong exercise's
 * work and hands it back as this one's. */
const myAt = ref(null);

/**
 * THE EDUCATOR IS WRITING IN THIS EDITOR.
 *
 * True for a student who is still following, and for nobody else. Everything it is gated on
 * is a rule that already exists rather than a new one:
 *
 *  - `mine` - the educator is the source, not an audience.
 *  - `controlSub` - a control tab's editor holds the student it is helping, not a lesson.
 *  - `beingDriven` - control outranks it, exactly as the bands do. A student whose screen is
 *    being driven has one person in their editor and must not have two.
 *  - `following` - and this is the whole way out. A student who moves stops following, which
 *    stops the sync, which unfreezes the editor. There is no second gesture to learn and no
 *    button that has to be found; the band says so in the sentence it already had.
 */
const synced = computed(() => !!(delivery.cohort && !delivery.mine && !controlSub.value
  && sync.on && delivery.following && !beingDriven()));
/** And whether the push in hand is for the exercise on screen - see `sync.at`. */
const syncedHere = computed(() =>
  synced.value && sync.code != null && progressId(sync.at) === progressId(currentId.value));

/**
 * WHAT THIS STUDENT HAD BEFORE THE DEMONSTRATION LANDED ON IT, so it can be given back.
 *
 * The band promises it, and without this the promise would be false: a student mid-attempt
 * when the educator starts writing would watch their query be replaced and then be left with
 * the educator's when it stopped. Being shown the answer is not the same as losing your own.
 *
 * ONLY THE EXERCISE ON SCREEN NEEDS ONE. The exercise component is keyed by row, so moving
 * away and back remounts it and it reloads its own starter or saved code - a synced buffer
 * cannot outlive the row it arrived on. That is why this is one stash rather than a map, and
 * why moving clears it.
 */
const beforeSync = ref(null);
watch(() => sync.when, () => {
  if (!synced.value || progressId(sync.at) !== progressId(currentId.value)) return;
  // The FIRST push into this exercise, and only it: every one after it would stash the
  // educator's own text back over the student's.
  if (beforeSync.value) return;
  // And never from a buffer belonging to another row - see `myAt`. Nothing is stashed and
  // nothing is restored, which is the honest failure next to handing back the wrong work.
  if (progressId(myAt.value) !== progressId(currentId.value)) return;
  beforeSync.value = { at: currentId.value, code: myCode.value };
});
/* Moving retires it. The restore is a PROP CHANGE the mounted editor reacts to, so a stash
 * kept for a row that is no longer on screen could never be handed back anyway - the
 * component remounts on return and its watcher does not fire for the value a prop already
 * had. What that costs is real and worth saying: a student who walks out of a demonstration
 * mid-way leaves their own attempt behind with it. The case the promise is actually about -
 * the educator finishing and switching off while the class is still there - is the one that
 * restores. */
watch(currentId, () => { beforeSync.value = null; });

/* Driving: every change goes with the position, because they change together - moving to an
 * exercise is also arriving at its starter code, and two messages would show one exercise's
 * prompt over another's buffer for as long as the second took to arrive. Already debounced
 * inside the exercise component. */
/* ONE EVENT CARRYING BOTH, and one send. They were two watchers on two refs, which meant a
 * caret change sent whatever text the debounce had last settled on - up to 300ms stale - and
 * a text change sent a caret from before it. A caret is an offset into a buffer; the two
 * cannot be allowed to arrive describing different documents. */
function editorChanged({ code, cursor }) {
  myCode.value = code;
  myCursor.value = cursor ?? null;
  myAt.value = current.value?.id ?? null;
  /* A CONTROL TAB DRIVES AND NEVER SYNCS. Its editor holds one student's work rather than
   * the educator's, and pushing that to the room would put somebody's half-finished attempt
   * on thirty screens - with their name nowhere near it. */
  if (controlSub.value) {
    if (drivingSomebody()) {
      drive({ at: current.value?.id ?? null, title: current.value?.title,
              slide: mySlide.value, code, cursor: myCursor.value });
    }
    return;
  }
  /* The room, when the switch is on. Every keystroke, already debounced inside the exercise
   * component - the same beat the drive above travels on, because it is the same thing being
   * watched from further away. */
  if (delivery.mine && sync.on) {
    pushEditor(current.value?.id ?? null, code, myCursor.value);
  }
}

/* Being driven: send what we have, ONCE, the moment control begins. This is the half that
 * actually helps - a progress row only ever holds the code that SOLVED an exercise, so a
 * student in the middle of getting one wrong has nothing recorded anywhere for an educator
 * to look at. After this the editor is read-only, so there is nothing further that could
 * have changed. */
watch(() => control.sub, sub => {
  if (sub && sub === session.sub) sendBuffer(current.value?.id ?? null, myCode.value);
});

/* And the educator applying it. Only for the exercise it was written against: control can be
 * taken while the tab is still landing on the student's position, and dropping somebody's
 * half-finished query into the wrong exercise is worse than not showing it. */
const shownCode = computed(() => {
  if (beingDriven()) return driven.code ?? undefined;
  // The demonstration, while it lasts and only where it belongs.
  if (synced.value) return syncedHere.value ? sync.code : undefined;
  /* And what was here before it. Reached the moment the switch goes off or the student
   * moves, which are the two ways a sync ends - and guarded on the row, so nothing is handed
   * back into an exercise it was never written in. */
  if (beforeSync.value && progressId(beforeSync.value.at) === progressId(currentId.value))
    return beforeSync.value.code;
  if (controlSub.value && borrowed.code != null
      && progressId(borrowed.at) === progressId(currentId.value)) return borrowed.code;
  return undefined;
});

/** Stop driving, from the educator's tab. */
function stopControl() {
  releaseControl();
  controlEnded.value = 'Control has ended.';
  /* Opened by `window.open`, so a script may close it. Browsers that refuse are left on the
   * notice above rather than dropped into a second live session. */
  setTimeout(() => window.close(), 60);
}

/** Stop being driven, from the student's. The session carries on. */
const stopBeingDriven = () => releaseControl();

/**
 * End it for everyone, and come back out to the cohort list where it was started.
 *
 * Where the class finished travels with the ending, because this is the only side that
 * knows it: the session row carries no position until step 4 broadcasts one. The title
 * goes too - a bookmark that can only say `2.4.1` makes the picker quote a number at a
 * tutor deciding which course to resume.
 */
/* An hour of a class, kept for as long as the screen showing it is open. Not a route: it is
 * a consequence of a button rather than a place, a reload has nothing to reload, and the
 * durable copy is a row somebody can read back later. */
const summary = ref(null);

async function endLiveHere() {
  const cohort = delivery.cohort;
  const at = current.value;
  const was = { cohort: delivery.title || cohort, course: delivery.course };
  try {
    /* The digest comes back WITH the ending - it is built from tallies on the row being
     * deleted, so this is the last moment anything can produce it without a second read. A
     * spinner here would be one over an answer we already had. */
    const s = await endLive(cohort, at ? { exercise: at.id, title: at.title } : null);
    if (s) { summary.value = { ...s, ...was }; return; }
  } catch (e) { liveError.value = e.message; return; }
  // Nothing came back - an older deployment, or a session already gone. Straight out.
  goAdmin('cohorts');
}

/** Back to where the tutor is, and following again from there. */
function catchUpHere() {
  catchUp();
  const at = followedPosition()?.exercise;
  if (at == null) return;
  const row = flat.value.find(e => progressId(e.id) === progressId(at));
  if (row) applied(() => { currentId.value = row.id; });
}

/**
 * Go to where a chat message was sent from.
 *
 * DELIBERATELY NOT THROUGH `applied()`. Opening somebody's question is a decision to go and
 * look at it, so it should stop the follow exactly as any other navigation does - the band
 * then says so and Catch up brings them back. Wrapping it would make this the one move in
 * the app that silently takes a student off the tutor's page while still claiming to be on
 * it.
 */
function goLive(at) {
  if (at == null) return;
  const row = flat.value.find(e => progressId(e.id) === progressId(at));
  if (row) currentId.value = row.id;
}

/* Asked before leaving, because leaving costs nothing and looks like it costs everything -
 * see LiveLeave.vue. Only a student is ever asked: an educator's button is End session, which
 * is a different act with a summary screen after it. */
const leaving = ref(false);
/* A lesson that ends while the question is on screen has answered it. Leaving nothing is not
 * a decision anybody needs to confirm, and a dialog over a session that is gone is a dialog
 * about nothing. */
watch(() => delivery.cohort, c => { if (!c) leaving.value = false; });

/** Leave one somebody else is running. The session carries on without us. */
function leaveLiveHere() {
  leaving.value = false;
  forgetLive();
  leaveArea();
}

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
/* Preview's scripted tutor needs somewhere to walk, and only this file knows what rows the
 * open course has. Registered once; `flat` is read at the moment it is asked. */
/* Only preview.js reads this, which is why it may carry more than a position: a scripted
 * class has to answer COHERENTLY - three people choosing C when C is not an option, or
 * being marked correct while the panel says they chose the wrong one, is a stand-in that
 * teaches you to distrust the screen. */
previewRows(() => flat.value.map(r => ({
  at: r.id, title: r.title,
  answer: r.answer ?? null,
  options: r.options?.length ?? 0,
})));

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
  /* `live` is in the exempt list beside `account`: a session is the one area a student is
   * SUPPOSED to be in, and it is where the invitation sends them. What differs between a
   * tutor and a student there is which half of the band they get, not whether they may be
   * there at all - and that is decided by the session's own `by`, not by this check. */
  if (appRoute.value && !['account', 'live'].includes(appRoute.value.area) && !isAdmin.value)
    leaveArea(true);
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
  /* After the courses, unlike watching: entering a session opens the course it names, and
   * `open()` needs the catalogue to have arrived to find it. */
  if (liveCohort.value) await enterLive(liveCohort.value);
  if (controlCohort.value) await enterLive(controlCohort.value, true);
  /* Asked once now and then once a minute. Started AFTER the session is restored, so a
   * student who reloaded inside a lesson is not offered an invitation to the lesson they are
   * already in for the second it would take the first answer to arrive. */
  if (authed.value && !isAdmin.value) watchForSessions();
});

async function onAuthenticated(token) {
  needsSignIn.value = false;
  loading.value = true;
  try { await startSession(token); authed.value = true; }
  catch (e) { loadError.value = e.message; loading.value = false; return; }
  await loadCourses();
  // Signing in during a lesson is the commonest way to meet one - a student told the class
  // has started opens the site, and the first thing they should see is the way in.
  if (!isAdmin.value) watchForSessions();
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
  /* AND NOTHING AT ALL IF THE ANSWER WAS SHOWN. The exercise still counts as complete and
   * still turns green - it is the XP that is forfeited, not the progress - so this is the
   * one place the two facts come apart. Read here rather than passed up from the exercise
   * component, because three components offer Show answer and only this one decides what a
   * solve is worth. */
  const shown = store.revealed(course.value.id).has(progressId(id));
  const worth = shown ? 0 : Number(flat.value.find(r => r.id === id)?.xp) || 0;
  solved.value = new Set([...solved.value, progressId(id)]);
  earned.value += worth;
  xpToday.value = (xpToday.value || 0) + worth;
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
watch(currentId, () => {
  if (!delivery.cohort) return;
  /* A control tab DRIVES rather than reports - see `enterLive`. Returned early, because
   * falling through would also call `reportPosition`, and the educator's two tabs would
   * then take turns telling the room where the educator is. */
  if (controlSub.value) {
    if (drivingSomebody()) drive({ at: current.value?.id ?? null, title: current.value?.title, slide: null });
    mySlide.value = null;
    return;
  }
  /* A move of their own is a decision, and it ends the following. The educator is exempt:
   * they are the thing being followed, and there is nothing for them to stop.
   *
   * LANDING WHERE THE CLASS ALREADY IS IS NOT WANDERING, whoever moved you and however you
   * got there. `applied` covers the moves this file knows it made; this covers the rest -
   * a race, a restored marker, a student who navigated to the very row being taught - and it
   * is the honest definition anyway. You have stopped following when you are somewhere the
   * lesson is not, not when a ref was assigned. */
  if (!applying && !delivery.mine && delivery.following) {
    const lead = followedPosition()?.exercise;
    /* AND ONLY WHEN WE KNOW WHERE THE CLASS IS. Not knowing is not evidence of having left
     * it: a client that has just joined has no roster yet, so `followedPosition()` is null
     * for the first second of every session - and treating that as wandering told students
     * they had stopped following a lesson they had that moment joined, with a Catch up button
     * for a position nobody had reported.
     *
     * The cost is a second in which a student who navigates deliberately is still counted as
     * following, and is then moved by the educator's next step. That is the lesser harm by
     * far, and it self-corrects on their next move. */
    if (lead != null && progressId(lead) !== progressId(currentId.value)) wandered();
  }
  mySlide.value = null;   // a new row starts a new range
  reportPosition();
});
watch(currentId, id => {
  urgeNext.value = false;
  if (course.value && id) subject.value.remember(course.value.id, id);
});
</script>

<template>
  <SignIn v-if="needsSignIn" @authenticated="onAuthenticated" />

  <div v-else class="app" :class="{ watching: !!watched || !!delivery.cohort || !!invited }">
    <TopBar
      :name="session.name" :email="session.email" :admin="isAdmin" :authed="authed"
      :avatar="session.avatar"
      :xp-today="xpToday"
      :watching="!!watched"
      @home="backToCourses" @admin="goAdmin()" @account="goAccount()" @signout="signOut" />

    <!-- Above everything, always, for as long as the session is open. The screens below it
         are the ordinary player, so this band is the only thing distinguishing a student's
         work from your own. -->
    <!-- CONTROL OUTRANKS BOTH, on either side of it. A tab that is driving somebody's
         screen must not describe itself as merely viewing them, and a student being driven
         must not be shown the ordinary following band - in both cases the milder statement
         is the one that would be believed. -->
    <ControlBand v-if="controlSub && drivingSomebody()" side="driving"
                 :name="control.name" :sharing="control.sharing"
                 @stop="stopControl" @sharing="setSharing" />
    <ControlBand v-else-if="beingDriven()" side="driven"
                 :by-name="control.byName" :sharing="control.sharing"
                 @stop="stopBeingDriven" />

    <WatchBanner v-else-if="watched" :name="watched.name" :email="watched.email"
                 @exit="goAdmin('people', watched.sub)" />

    <!-- Never both. Watching somebody's session and leading a live one are two different
         answers to "whose screen is this", and a screen claiming both is a screen that has
         answered neither. -->
    <LiveBand v-else-if="delivery.cohort" :session="delivery" :mine="delivery.mine"
              :cohort-title="delivery.title || delivery.cohort"
              :course-title="allCourses.find(c => c.id === delivery.course)?.title"
              :here="Object.keys(room.here).length"
              :following="delivery.following"
              :can-catch-up="!!followedPosition()"
              :leader-at="followedPosition()?.title"
              :shared-name="control.sharing ? control.name : ''"
              :syncing="sync.on"
              @end="endLiveHere" @leave="leaving = true" @catch-up="catchUpHere"
              @sync="setSync" />

    <LiveLeave v-if="leaving" :name="delivery.name"
               :cohort-title="delivery.title"
               @leave="leaveLiveHere" @close="leaving = false" />

    <!-- Floating rather than docked, and drawn HERE rather than inside the panel: the panel
         can be collapsed to a rail and a chat window that vanished with it would not be
         undocked, it would be hidden. Out of flow, so it takes no row of this grid. -->
    <LiveChat v-if="delivery.cohort && chat.popped && !controlSub" popped :here-at="currentId"
              @goto="goLive" />

    <!-- Out of flow, so it takes no row of this grid. Never in a control tab: that screen is
         somebody else's session and a message addressed to the educator does not belong on
         top of it. -->
    <ChatToast v-if="delivery.cohort && chat.toast && !controlSub" :message="chat.toast"
               @open="revealChat" @close="hideToast" />

    <!-- User management is a whole mode of its own, not a pane of the player: it has no
         use for the exercise nav, and it has to be reachable from the grid, where there is
         none. -->
    <!-- A session that had already ended when the link was opened. On the grid rather than
         in a dialog: there is nothing to dismiss and nowhere to go back to, and the student
         is already where they would have ended up anyway. -->
    <!-- LAST OF THE BANDS AND FIRST IN IMPORTANCE TO SOMEBODY NOT YET IN A LESSON. It can
         only appear when none of the others has, because `invitation()` is null while this
         client is in a session - so the ordering here is documentation rather than a
         guard. -->
    <LiveInvite v-if="invited" :session="invited"
                :course-title="allCourses.find(c => c.id === invited.course)?.title"
                @join="joinInvited(invited.cohort)" />

    <!-- ONE NOTICE, NEVER TWO. Each of these is a row of the shell's grid, and a second one
         appearing beside a band pushes the player out of the row that gives it its height -
         so they share an element rather than each taking their chances.
         A control tab whose control has ended says so and STOPS: it must not quietly become
         a second live tab, or this browser would report the educator's position from two
         places and the class would follow whichever moved last. A refusal always names its
         reason, because both of them - somebody else already has them, they are not
         connected - are things an educator can act on and neither is guessable from a button
         that appeared to do nothing. -->
    <p v-if="liveError || controlEnded || control.refused" class="livegone" role="status">
      {{ liveError || controlEnded || control.refused }}<template
        v-if="controlEnded && !liveError"> You can close this tab.</template>
    </p>

    <!-- BEFORE THE ADMIN PANEL AND BEFORE THE GRID, because it is a mode: the lesson is over
         and this is what there is to look at. Leaving it is the Done button, which is also
         the only way out - the alternative is a screen somebody navigates away from and can
         never get back to, having read none of it. -->
    <SessionSummary v-if="summary" :summary="summary"
                    :cohort-title="summary.cohort"
                    :course-title="allCourses.find(c => c.id === summary.course)?.title"
                    @done="summary = null; goAdmin('cohorts')" />

    <AdminPanel v-else-if="showAdmin" :courses="allCourses" @close="leaveArea()" />

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

    <div v-else class="shell"
         :class="{ railed: !pinned, live: !!delivery.cohort && !controlSub, tucked: !panelOpen }">
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
          :deck="current.deck"
          :course-id="course.id"
          :note-count="currentTopic?.notes"
          :goto="followSlide"
          :row="current"
          @slide="n => { mySlide = n;
                         if (controlSub) { if (drivingSomebody()) drive({ at: current?.id ?? null, title: current?.title, slide: n }); }
                         else if (delivery.cohort) reportPosition(); }" />
        <!-- TWO PEOPLE TYPING INTO ONE BUFFER is not a thing this can do, and there are two
             ways to end up with two: somebody driving this screen, and the educator writing
             in every screen at once. Hence `frozen` in both cases, and a band for each. -->
        <component
          v-else-if="current"
          :is="componentFor[current.type] || CodingExercise"
          :key="current.id"
          :course-id="course.id"
          :exercise="current"
          :done="isSolved(current.id)"
          :saved="savedCode[current.id]"
          :class-answers="classAnswers"
          :frozen="beingDriven() || synced"
          :driven-code="shownCode"
          @solved="markSolved"
          :peer-at="beingDriven() ? driven.cursor : (syncedHere ? sync.cursor : null)"
          :peer-name="beingDriven() ? control.byName : delivery.name"
          @checked="(id, v) => reportMark({ at: id, ...v })"
          @editor="editorChanged" />

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

      <!-- Last in the row, so the deck and the exercise keep the middle. It is the room
           rather than the lesson: a tutor glances at it, and a student mostly does not. -->
      <LivePanel v-if="delivery.cohort && !controlSub" :leader-at="leaderAt" :can-control="delivery.mine"
                 :here-at="currentId"
                 :marks="marksHere" :grading="delivery.mine && gradableHere"
                 :controlled="control.sub || ''"
                 @width="w => panelOpen = w" @goto="goLive"
                 @control="who => takingOver = who" />

      <ControlStart v-if="takingOver" :name="takingOver.name"
                    :others="Math.max(0, Object.keys(room.here).length - 2)"
                    @take="startControl" @close="takingOver = null" />

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
/* Same reason as the line above: the notice is a fourth child, so without a row of its own
   it would take the `1fr` and push the player out of the grid. `auto` collapses to nothing
   while it is absent, which is why it can be declared unconditionally. */
/* A BAND AND A NOTICE IS FOUR CHILDREN. This said three for both cases, which was only ever
   right because the one notice that existed - a session that had already ended - could not
   co-occur with a band for the session it was about. A control tab can show both, and the
   fourth child would take an implicit row and leave the player without the `1fr` that gives
   it its height. */
.app.watching:has(> .livegone) { grid-template-rows: auto auto auto minmax(0, 1fr); }
.app:has(> .livegone) {
  grid-template-rows: auto auto minmax(0, 1fr);
}
.livegone { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--ice-bad);
            background: var(--ice-bad-fill); border-bottom: 1px solid var(--ice-border); }
.shell { display: grid; grid-template-columns: 272px minmax(0, 1fr); height: 100%; min-height: 0; }
.shell:has(> .slides) { grid-template-columns: 272px minmax(0, 1fr) minmax(0, 38%); }
.shell.railed { grid-template-columns: 44px minmax(0, 1fr); }
.shell.railed:has(> .slides) { grid-template-columns: 44px minmax(0, 1fr) minmax(0, 38%); }
/* The room, as a fixed last column. Fixed rather than a fraction because it is a list of
   names: it does not get more useful with more room, and every pixel it took would come
   off the exercise, which does. The slides pane gives up the width instead - it is the one
   thing on screen that can be scrolled and re-read.

   336 rather than 300 because it holds the chat as well now, and a message wrapping every
   four words is a log nobody reads. That is also the width the mock screens were drawn at. */
.shell.live { grid-template-columns: 272px minmax(0, 1fr) 336px; }
.shell.live:has(> .slides) { grid-template-columns: 272px minmax(0, 1fr) minmax(0, 30%) 336px; }
.shell.railed.live { grid-template-columns: 44px minmax(0, 1fr) 336px; }
.shell.railed.live:has(> .slides) { grid-template-columns: 44px minmax(0, 1fr) minmax(0, 30%) 336px; }
/* Collapsed, it is the same 44px rail the sidebar leaves - and it gives its width back to
   the exercise rather than to the slides, because the exercise is what a student collapsed
   it to make room for. */
.shell.live.tucked { grid-template-columns: 272px minmax(0, 1fr) 44px; }
.shell.live.tucked:has(> .slides) { grid-template-columns: 272px minmax(0, 1fr) minmax(0, 38%) 44px; }
.shell.railed.live.tucked { grid-template-columns: 44px minmax(0, 1fr) 44px; }
.shell.railed.live.tucked:has(> .slides) { grid-template-columns: 44px minmax(0, 1fr) minmax(0, 38%) 44px; }

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
