<script setup>
/* The admin area: its shell, and the People section inside it.
 *
 * THE SHELL IS THE POINT OF THIS FILE AS MUCH AS THE LIST IS. What was here was one modal
 * over the course grid - no address, nowhere for a second screen to go, so every feature
 * added had to be another dialog or another column. `SECTIONS` is now the one place a
 * section is declared, `route.js` says which one you are in, and adding the Courses and
 * Platform pages is an entry here rather than a rewrite. See ADMIN.md.
 *
 * The nav is drawn only where there is a choice to make. One section is a heading, not a
 * tab strip, and a strip with one live tab and two dead ones would be an announcement of
 * work not done rather than navigation.
 *
 * People: everyone who can sign in, and what they are on.
 *
 * This replaced a screen that could only answer "who is on course X", one course at a time,
 * and whose only two actions were invite and unenrol. A person exists across courses -
 * their account, their rights, whether their invitation ever landed - so the list is of
 * people, and the course is a filter over it rather than the thing being listed.
 *
 * The whole list arrives in one call and every filter is applied here. That is a deliberate
 * ceiling: it is right for a training company's few hundred accounts and wrong for tens of
 * thousands, and the API says `truncated` when it has stopped rather than letting a partial
 * list read as the whole pool.
 */
import { ref, computed, onMounted } from 'vue';
import { api } from '../auth.js';
import UserDialog from './UserDialog.vue';
import UserImport from './UserImport.vue';
import CohortList from './CohortList.vue';
import PersonPage from './PersonPage.vue';
import CoursePage from './CoursePage.vue';
import Icon from './Icon.vue';
import { route, go, watch as goWatch, leave } from '../route.js';

const props = defineProps({ courses: Array });
const emit = defineEmits(['close']);

/* Every section of the admin area, in nav order. Courses and Platform are not here yet -
 * an entry with no screen behind it is a promise, and this list is what gets read to find
 * out what exists. */
const SECTIONS = [
  { id: 'people', title: 'People' },
  { id: 'courses', title: 'Courses' },
  { id: 'cohorts', title: 'Cohorts' },
];
/* An unknown section falls back rather than blanking the screen: the URL is typed by hand
 * often enough, and `#/admin/curses` should land somewhere real. */
const section = computed(() =>
  SECTIONS.find(s => s.id === route.value?.section)?.id || 'people');

const users = ref([]);
/* The cohort catalogue comes back with the users, in the same call - an empty cohort has to
 * exist (you name a class before you import it), so this cannot be derived from who is in
 * one. */
const cohorts = ref([]);
const truncated = ref(false);
const loading = ref(true);
const error = ref('');
const notice = ref('');

const query = ref('');
/* '' | a course id | '@'+cohort id | '@none' | '!none' | '!admins' | '!invited' | '!suspended'.
 * Cohorts are prefixed because a course id and a cohort id are both slugs and nothing stops
 * a class being called `data-analyst-sql`. */
const filter = ref('');
const editing = ref(undefined);  // undefined = closed, null = adding, object = editing
const importing = ref(false);

const titles = computed(() => Object.fromEntries((props.courses || []).map(c => [c.id, c.title])));

async function refresh() {
  error.value = ''; loading.value = true;
  try {
    const r = await api('admin/users');
    users.value = r.users;
    cohorts.value = r.cohorts || [];
    truncated.value = !!r.truncated;
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}
onMounted(refresh);

/* `#/admin/people/<sub>` is one person, and the page is what it draws. The listing arrives
 * after the route does on a deep link, so `viewing` is the sub and the row is looked up
 * whenever it turns up - the page draws what it has and fills in the rest.
 *
 * The dialog kept its job: adding somebody, and editing one. It is opened from the page
 * rather than by the URL, so it is state beside the route rather than part of it - Back
 * from a dialog would otherwise mean something different from Back anywhere else. */
const viewing = computed(() => (section.value === 'people' ? route.value?.id || '' : ''));
const person = computed(() => users.value.find(u => u.sub === viewing.value));

/* A course id in the URL that names no published course falls back to the list rather than
 * drawing an empty page: the catalogue is assembled from the bucket, so a course really can
 * stop existing while somebody has its URL open. */
const openCourse = computed(() => (section.value === 'courses'
  ? (props.courses || []).find(c => c.id === route.value?.id) || null
  : null));

/* How many people are on each course. Tallied from what the listing already carried, which
 * is now a derivation rather than a row count: `courses` on a user is the union of what
 * their intakes take. Still one number per course and still no extra call. */
const enrolled = computed(() => {
  const n = {};
  for (const u of users.value) for (const c of u.courses || []) n[c] = (n[c] || 0) + 1;
  return n;
});

async function done(message) {
  editing.value = undefined;
  importing.value = false;
  notice.value = message || '';
  await refresh();
  /* Deleting somebody is the one edit that makes the page you are on meaningless. Rather
   * than the dialog reporting which action it was, this asks the only question that
   * matters afterwards: is that person still there? */
  if (viewing.value && !users.value.some(u => u.sub === viewing.value)) go('people');
}

const cohortTitles = computed(() => Object.fromEntries(cohorts.value.map(c => [c.id, c.title])));
/* Archived cohorts stay in the filter, at the bottom: looking back at a finished intake is
 * most of what archiving one is for. */
const filterable = computed(() => [...cohorts.value]
  .sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.title.localeCompare(b.title)));

/* Sorted by name, and the sort key is what the row actually shows: a user with no name is
 * drawn by their address, so sorting on the empty name would file them all together at the
 * top under nothing. */
const label = u => u.name || u.email;

const shown = computed(() => {
  const q = query.value.trim().toLowerCase();
  return users.value
    .filter(u => !q || u.email.includes(q) || u.name.toLowerCase().includes(q))
    .filter(u => {
      const f = filter.value;
      if (!f) return true;
      if (f === '!none') return !u.courses.length;
      if (f === '!admins') return u.admin;
      if (f === '!online') return !!u.online;
      if (f === '!invited') return u.status === 'FORCE_CHANGE_PASSWORD';
      if (f === '!suspended') return !u.enabled;
      if (f === '@none') return !(u.cohorts || []).length;
      if (f.startsWith('@')) return (u.cohorts || []).includes(f.slice(1));
      return u.courses.includes(f);
    })
    .sort((a, b) => label(a).localeCompare(label(b)));
});

const state = u => (!u.enabled ? { text: 'Suspended', tone: 'bad' }
  : u.status === 'FORCE_CHANGE_PASSWORD' ? { text: 'Invited', tone: 'wait' }
  : { text: 'Active', tone: 'good' });

/* WHEN SOMEBODY WAS LAST WORKING, in the words the answer is actually useful in.
 *
 * RELATIVE WHILE IT IS RECENT AND A DATE ONCE IT IS NOT. "Four days ago" is a fact you can
 * act on and "213 days ago" is arithmetic nobody asked for - so the phrasing changes where
 * the question does, which is at about a week.
 *
 * DELIBERATELY NOT `CoursePage`'s `when`, which is a bare date, and the difference is the
 * question rather than the style: that column is sorted over weeks to find who has stopped,
 * and this one is read to see who is around today. One helper serving both would have to be
 * wrong for one of them.
 *
 * NEVER IS AN EM DASH, NOT "never". The row already says "Invited" when somebody has not
 * opened their account, and saying it twice in two columns reads as two different facts. */
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const seenAt = iso => {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(+then)) return '—';
  const gap = Date.now() - +then;
  if (gap < 2 * MINUTE) return 'just now';
  if (gap < HOUR) return `${Math.round(gap / MINUTE)} min ago`;
  if (gap < DAY) { const h = Math.round(gap / HOUR); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (gap < 2 * DAY) return 'yesterday';
  if (gap < 7 * DAY) return `${Math.round(gap / DAY)} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
</script>

<template>
  <div class="admin">
    <div class="card">
      <nav v-if="SECTIONS.length > 1" class="sections">
        <button v-for="s in SECTIONS" :key="s.id" class="sec"
                :class="{ on: section === s.id }" :aria-current="section === s.id"
                @click="go(s.id)">{{ s.title }}</button>
        <button class="btn ghost done" @click="emit('close')">Done</button>
      </nav>

      <header v-if="section === 'people' && !viewing">
        <div>
          <h2>People</h2>
          <p class="muted">Everyone who can sign in. Adding somebody creates their account
            and emails them a temporary password that lasts seven days.</p>
        </div>
        <div class="actions">
          <button class="btn" @click="importing = true">Import CSV</button>
          <button class="btn primary" @click="editing = null">Add user</button>
        </div>
      </header>
      <header v-else-if="section === 'courses' && !openCourse">
        <div>
          <h2>Courses</h2>
          <p class="muted">Every course on the site. Opening one shows who is on it and how
            far they have got.</p>
        </div>
      </header>
      <header v-else-if="section === 'cohorts'">
        <div><h2>Cohorts</h2></div>
      </header>

      <!-- Above the sections rather than inside the list: editing somebody from their own
           page has to be able to say that it worked, and the list is not on screen. -->
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="notice" class="ok">{{ notice }}</p>

      <PersonPage v-if="viewing" :sub="viewing" :user="person"
                  :courses="courses" :cohorts="cohorts"
                  @edit="editing = person" @back="go('people')"
                  @watch="goWatch(viewing)" />

      <CoursePage v-else-if="openCourse" :course="openCourse" :users="users" :cohorts="cohorts"
                  @person="sub => go('people', sub)" @back="go('courses')" />

      <ul v-else-if="section === 'courses'" class="list">
        <li v-for="c in courses" :key="c.id">
          <button class="crow" type="button" @click="go('courses', c.id)">
            <span class="cname">{{ c.title }}</span>
            <span class="num">{{ c.exercises || 0 }} exercises</span>
            <!-- An open course is on everybody's grid without an enrolment row, so a count
                 of nought there is not a course nobody is taking. -->
            <span v-if="c.open" class="num">open to everyone</span>
            <span v-else class="num">{{ enrolled[c.id] || 0 }} enrolled</span>
          </button>
        </li>
        <li v-if="!courses.length" class="none">No courses are published yet.</li>
      </ul>

      <CohortList v-else-if="section === 'cohorts'" :cohorts="cohorts" :users="users"
                  :courses="courses"
                  @done="m => { notice = m || ''; refresh(); }" />

      <template v-else>
        <div class="tools">
          <input v-model="query" type="search" class="search" placeholder="Search name or email…">
          <select v-model="filter" aria-label="Filter">
            <option value="">All users</option>
            <optgroup v-if="filterable.length" label="Cohorts">
              <option v-for="c in filterable" :key="c.id" :value="'@' + c.id">
                {{ c.title }}<template v-if="c.archived"> (archived)</template>
              </option>
              <option value="@none">In no cohort</option>
            </optgroup>
            <optgroup label="Courses">
              <option v-for="c in courses" :key="c.id" :value="c.id">On {{ c.title }}</option>
              <option value="!none">On no course</option>
            </optgroup>
            <optgroup label="Accounts">
              <option value="!admins">Admins</option>
              <option value="!online">In a lesson now</option>
              <option value="!invited">Not signed in yet</option>
              <option value="!suspended">Suspended</option>
            </optgroup>
          </select>
          <span class="count">{{ shown.length }}<template v-if="shown.length !== users.length"> of {{ users.length }}</template></span>
        </div>

        <p v-if="truncated" class="err">There are more accounts than this screen lists. Search
          narrows what is drawn, not what was fetched - so somebody may be missing from it.</p>

        <p v-if="loading" class="muted">Loading…</p>
        <div v-else class="tablewrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Cohort</th><th>Courses</th>
                  <th>Last seen</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="u in shown" :key="u.sub" @click="go('people', u.sub)">
                <td>
                  <!-- CONNECTED RIGHT NOW, which is only ever true while a lesson is
                       running - so it is a dot beside the name rather than a column of its
                       own, which would be empty most of the day. The Last seen column is
                       what the row says the rest of the time. Titled, because a coloured
                       dot with no words is a legend somebody has to be told. -->
                  <span class="dot" :class="{ live: u.online }"
                        :title="u.online ? 'In a lesson now' : 'Not connected'"></span>
                  <strong>{{ u.name || '—' }}</strong>
                  <span v-if="u.admin" class="tag admin">admin</span>
                </td>
                <td class="addr">{{ u.email }}</td>
                <td>
                  <span v-if="!(u.cohorts || []).length" class="dim">—</span>
                  <span v-for="c in u.cohorts" :key="c" class="tag">{{ cohortTitles[c] || c }}</span>
                </td>
                <td>
                  <!-- An admin sees every course whatever their cohorts take - App.vue
                       skips the filter for them - so listing what their intakes give them
                       here reads as a limit that is not one, and a promoted student would
                       appear to have lost the rest of the catalogue. -->
                  <span v-if="u.admin" class="dim">All courses</span>
                  <template v-else>
                    <span v-if="!u.courses.length" class="dim">none</span>
                    <span v-for="c in u.courses" :key="c" class="tag">{{ titles[c] || c }}</span>
                  </template>
                </td>
                <!-- "In the lesson" outranks a timestamp: somebody connected right now was
                     also working a minute ago, and printing "1 min ago" beside a live dot
                     says the smaller of the two true things. -->
                <td class="seen" :class="{ dim: !u.online && !u.seen }">
                  {{ u.online ? 'In the lesson' : seenAt(u.seen) }}
                </td>
                <td><span class="state" :class="state(u).tone">{{ state(u).text }}</span></td>
                <!-- The whole row opens the dialog, so this is the keyboard route to the
                     same thing rather than the only one - hence a real button with a label
                     on it, not a decorative glyph. -->
                <td class="right">
                  <button class="iconbtn" type="button" title="Edit" aria-label="Edit"
                          @click.stop="go('people', u.sub)"><Icon name="edit" :size="15" /></button>
                </td>
              </tr>
              <tr v-if="!shown.length"><td colspan="7" class="none">
                {{ users.length ? 'Nobody matches that.' : 'Nobody yet.' }}
              </td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <UserDialog
      v-if="editing !== undefined"
      :user="editing" :courses="courses" :cohorts="cohorts"
      @done="done" @close="editing = undefined" />

    <!-- Closed rather than finished - escape, or the scrim - still refreshes: an import
         that was interrupted has already invited everyone it got to. -->
    <UserImport
      v-if="importing"
      :courses="courses" :cohorts="cohorts"
      @done="done" @close="importing = false; refresh()" />
  </div>
</template>

<style scoped>
.admin { height: 100%; overflow: auto; padding: 40px 32px; display: flex; justify-content: center; }
.card { width: min(1040px, 100%); }
.list { list-style: none; margin: 0; padding: 0;
        border: 1px solid var(--ice-border); border-radius: var(--ice-radius); overflow: hidden; }
.list li { border-bottom: 1px solid var(--ice-border); }
.list li:last-child { border-bottom: 0; }
.list li.none { padding: 14px; color: var(--ice-fg-muted); font-size: 13px; }
.crow { display: flex; align-items: center; gap: 16px; width: 100%; font: inherit;
        font-size: 14px; text-align: left; padding: 13px 14px; cursor: pointer;
        background: none; border: 0; color: var(--ice-fg); }
.crow:hover { background: var(--ice-raise); }
.cname { flex: 1; font-weight: 500; }
.crow .num { font-size: 12px; color: var(--ice-fg-muted); white-space: nowrap; }

.sections { display: flex; align-items: center; gap: 4px; margin-bottom: 22px;
            border-bottom: 1px solid var(--ice-border); }
.sec { font: inherit; font-size: 14px; padding: 8px 12px 11px; margin-bottom: -1px;
       background: none; border: 0; border-bottom: 2px solid transparent;
       color: var(--ice-fg-muted); cursor: pointer; }
.sec:hover { color: var(--ice-fg); }
.sec.on { color: var(--ice-fg); border-bottom-color: var(--ice-primary); }
.done { margin-left: auto; margin-bottom: 6px; }

header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h2 { margin: 0; font-size: 22px; }
.actions { display: flex; gap: 8px; flex: none; }
.muted { color: var(--ice-fg-muted); font-size: 13px; margin: 8px 0 0; max-width: 60ch; line-height: 1.6; }

.tools { display: flex; align-items: center; gap: 10px; margin: 24px 0 14px; }
.search { flex: 1; max-width: 320px; }
.search, select { font: inherit; font-size: 14px; padding: 8px 11px;
                  background: var(--ice-bg); color: var(--ice-fg);
                  border: 1px solid var(--ice-border); border-radius: 8px; }
.search:focus, select:focus { outline: none; border-color: var(--ice-primary); }
.count { margin-left: auto; font-size: 12px; color: var(--ice-fg-muted);
         background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
         border-radius: 5px; padding: 3px 8px; }

.err { color: var(--ice-bad); font-size: 13px; }
.ok { color: var(--ice-good); font-size: 13px; }

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
.addr { color: var(--ice-fg-muted); font-size: 13px; }
.right { text-align: right; white-space: nowrap; width: 1%; }
.iconbtn { display: inline-flex; padding: 5px; border-radius: 6px; cursor: pointer;
           background: none; border: 1px solid transparent; color: var(--ice-fg-muted); }
.iconbtn:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }
.iconbtn:focus-visible { outline: none; border-color: var(--ice-primary); color: var(--ice-fg); }
.none { color: var(--ice-fg-muted); text-align: center; padding: 28px; cursor: default; }
.dim { color: var(--ice-fg-muted); }

.tag { display: inline-block; font-size: 11px; border: 1px solid var(--ice-border);
       background: var(--ice-bg-soft); border-radius: 5px; padding: 1px 7px; margin: 1px 4px 1px 0; }
.tag.admin { color: var(--ice-primary-strong); border-color: var(--ice-primary-soft); margin-left: 8px;
             text-transform: uppercase; letter-spacing: .05em; font-size: 10px; }
/* THE DOT IS DRAWN FOR EVERYBODY AND NOT ONLY FOR WHOEVER IS ON, so the column keeps its
   shape whether or not a lesson is running - a mark that appears and disappears makes every
   name jump sideways the moment somebody connects, and one that is only ever present when
   lit is a decoration rather than a state.

   UNLIT IS A RING, NOT A PALE FILL, and that is the whole difference between this being
   visible and not. It was `--ice-border`, which is #e2e8f0 - a seven-pixel near-white circle
   on a near-white row, invisible in exactly the state it is in most of the day, so the
   feature read as not having shipped. A border colour is for lines a metre long; it does not
   survive being cut down to a 3.5px radius. So the empty state is an OUTLINE in the muted
   text colour, which is a colour chosen to be read. */
.dot { display: inline-block; box-sizing: border-box; width: 9px; height: 9px;
       border-radius: 50%; margin-right: 8px; vertical-align: middle;
       border: 1.5px solid var(--ice-fg-muted); background: transparent; opacity: .75; }
.dot.live { border-color: var(--ice-good-line); background: var(--ice-good-line); opacity: 1;
            box-shadow: 0 0 0 3px var(--ice-good-fill); }
.seen { font-size: 12px; color: var(--ice-fg-muted); white-space: nowrap; }
.seen.dim { opacity: 0.55; }
.state { font-size: 12px; }
.state.good { color: var(--ice-good); }
.state.wait { color: var(--ice-fg-muted); }
.state.bad { color: var(--ice-bad); }
@media (max-width: 720px) {
  header { flex-direction: column; }
  .tools { flex-wrap: wrap; }
}
</style>
