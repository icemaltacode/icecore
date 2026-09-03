<script setup>
/* Inviting a class at a time.
 *
 * A file, a preview of what it will do, then one POST per row. Per row rather than one bulk
 * call on purpose: an import is thirty independent invitations, a single one of which can
 * fail for its own reason - an address Cognito rejects, a duplicate - and a bulk endpoint
 * would have to choose between failing the lot and hiding which one went wrong. Row by row,
 * the twenty-nine still land and the screen names the one to fix.
 *
 * Nothing is sent until the preview has been looked at. The parse is entirely local, so the
 * preview costs nothing and is the only chance to notice that the cohort column is wrong
 * before thirty people are invited into a class that takes nothing.
 *
 * THERE IS NO COURSE COLUMN ANY MORE. A course reaches somebody through the intake they are
 * in, so what this file decides is which class each person joins - and the preview answers
 * "and what does that put them on" per row, because that is the question a tutor is actually
 * checking and it is now one hop away rather than written in the file. A `courses` column in
 * an older file is not an error and is not obeyed either: it is called out above the preview,
 * because silently ignoring a column somebody filled in is how a class ends up on nothing.
 */
import { ref, computed } from 'vue';
import { api } from '../auth.js';
import { parseUsers, templateCsv } from '../csv.js';

const props = defineProps({ courses: Array, cohorts: Array });
const emit = defineEmits(['done', 'close']);

const rows = ref([]);
const parseError = ref('');
const filename = ref('');
const cohort = ref('');              // the cohort everyone in the file joins
const running = ref(false);
const results = ref(null);           // [{ email, ok, message }] once it has run

/* A cohort name resolves to an existing cohort by id or by title, case-insensitively, and
 * anything else is a NEW cohort. That resolution is advisory: the API does it again and its
 * answer is the one that counts, because two tutors importing two class lists at the same
 * moment can only land in one cohort if one side decides. What this copy is for is the
 * preview - naming what is about to be created is what makes creating it safe. */
const resolve = name => {
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const hit = (props.cohorts || []).find(c =>
    c.id === wanted || c.title.trim().toLowerCase() === wanted.toLowerCase());
  return hit
    ? { id: hit.id, title: hit.title, fresh: false, courses: hit.courses || [] }
    : { id: wanted, title: wanted, fresh: true, courses: [] };
};

/* A row's only problem now is its own - an address Cognito would refuse. An unknown COURSE
 * used to block a row here, and there is nothing left for that check to read: the file no
 * longer says what anybody is on.
 *
 * The typed cohort is ADDED to whatever the row's own `cohort` column names, rather than
 * filling in only for the rows that name none. Both rules cover the common case - a plain
 * class list with no cohort column at all - and only this one can be stated in a sentence.
 * "Everyone here, plus whatever their row says" is a thing an admin can hold in their head;
 * "these, but only where the row was blank" is a rule you have to work out per row, from a
 * file you cannot see while you are typing. The preview shows what each row resolved to, so
 * the sum is never hidden. */
const decorated = computed(() => rows.value.map(r => {
  const joins = [cohort.value, ...r.cohorts].map(resolve).filter(Boolean);
  const seen = new Set();
  const cohortsOn = joins.filter(c => !seen.has(c.id.toLowerCase()) && seen.add(c.id.toLowerCase()));
  /* WHAT THIS ROW ENDS UP ON, which the file does not say and the tutor is checking for.
   * Only what these intakes take: somebody already in another class is on more than this,
   * and claiming otherwise from a file that cannot know it would be worse than saying less.
   * A cohort about to be created takes nothing yet, which is exactly the case worth seeing
   * before thirty invitations go out. */
  const enrol = [...new Set(cohortsOn.flatMap(c => c.courses))];
  return { ...r, enrol, cohortsOn, blocked: !!r.problem };
}));
const usable = computed(() => decorated.value.filter(r => !r.blocked));
const blocked = computed(() => decorated.value.filter(r => r.blocked));

/* A column that used to mean something and now does not. Called out rather than obeyed and
 * rather than ignored: a tutor who filled it in believes it did something. */
const ignoredCourses = computed(() =>
  rows.value.some(r => (r.courses || []).length));
/* Rows that will be invited onto nothing. Not blocked - inviting somebody before their class
 * has been given a course is a real order of doing things - but said, because an empty grid
 * is what it looks like to them and there is no other warning of it. */
const onNothing = computed(() => usable.value.filter(r => !r.enrol.length).length);

/* An unknown cohort is CREATED rather than refused: naming this intake is what the column is
 * for. What it gets instead is a sentence before anything is sent, because the failure it can
 * cause - a class quietly split in two by a typo - is invisible afterwards, and because a
 * cohort created here takes no course until somebody gives it one. */
const creating = computed(() => {
  const fresh = new Map();
  for (const r of usable.value)
    for (const c of r.cohortsOn) if (c.fresh) fresh.set(c.id.toLowerCase(), c.title);
  return [...fresh.values()];
});

function pick(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  filename.value = file.name;
  results.value = null;
  const reader = new FileReader();
  reader.onload = () => {
    const { rows: parsed, error } = parseUsers(String(reader.result || ''));
    rows.value = parsed; parseError.value = error;
  };
  reader.onerror = () => { parseError.value = 'That file could not be read.'; };
  reader.readAsText(file);
}

function download() {
  const blob = new Blob([templateCsv(props.courses || [], props.cohorts || [])],
    { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'icecore-users.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function run() {
  running.value = true;
  results.value = [];
  /* One at a time, not Promise.all. Each row is an AdminCreateUser and an email, and
   * Cognito rate-limits both; thirty at once is how an import half-succeeds with a
   * throttling error that says nothing about which students it dropped. Sequential also
   * means the list below fills in as it goes, which is the progress indicator. */
  for (const row of usable.value) {
    try {
      const r = await api('admin/users', {
        method: 'POST',
        body: {
          email: row.email,
          name: row.name || undefined,
          cohorts: row.cohortsOn.map(c => c.id),
          admin: row.admin,
        },
      });
      results.value = [...results.value, {
        email: row.email, ok: true,
        message: r.invited ? 'Invited' : 'Already had an account - added',
      }];
    } catch (e) {
      results.value = [...results.value, { email: row.email, ok: false, message: e.message }];
    }
  }
  running.value = false;
  /* Deliberately NOT emitting `done` here. Doing so closes this dialog the instant the last
   * row lands, and the per-row result list - the only place the failures are named - is
   * gone before anyone has read it. The footer's Done button reports the summary instead. */
}

const summary = computed(() => {
  const done = results.value || [];
  const good = done.filter(r => r.ok).length;
  const bad = done.length - good;
  return `${good} user${good === 1 ? '' : 's'} imported`
    + (bad ? `, ${bad} failed` : '')
    + (blocked.value.length ? `, ${blocked.value.length} skipped` : '') + '.';
});
</script>

<template>
  <div class="scrim" @click.self="running || emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" @keydown.esc="running || emit('close')">
      <header>
        <h2>Import users</h2>
        <button class="x" title="Close" :disabled="running" @click="emit('close')">✕</button>
      </header>

      <p class="lead">A CSV with an <code>email</code> column, and optionally
        <code>name</code>, <code>cohort</code> and <code>admin</code>. Everyone in it is
        invited by email and put in the cohorts named, exactly as if they had been added one
        at a time — and a cohort is what puts them on a course.</p>

      <div class="pickrow">
        <label class="file btn">
          <input type="file" accept=".csv,text/csv,text/plain" @change="pick">
          Choose a file…
        </label>
        <span v-if="filename" class="filename">{{ filename }}</span>
        <button class="link" type="button" @click="download">Download the template</button>
      </div>

      <p v-if="parseError" class="err">{{ parseError }}</p>

      <!-- Above the preview and visible before a file is chosen, because it is part of
           setting the import up rather than a correction to it. Hidden behind "some row
           has no cohort" it would be invisible in the one case it matters most - a plain
           class list, which has no cohort column at all and so no rows to notice. -->
      <div v-if="!results" class="assignbox">
        <label for="ui-cohort">Put everyone in this file in the cohort</label>
        <input id="ui-cohort" v-model="cohort" type="text" list="ui-cohorts"
               placeholder="Sept 2026 evening">
        <datalist id="ui-cohorts">
          <option v-for="c in (cohorts || []).filter(c => !c.archived)" :key="c.id" :value="c.title" />
        </datalist>
        <p class="note">Added to whatever a row's own <code>cohort</code> column names. A
          name that is not already a cohort creates one.</p>
      </div>

      <!-- A column that used to do something. Said plainly, because a tutor who filled it in
           has every reason to think it still works. -->
      <p v-if="ignoredCourses && !results" class="creating">
        This file has a <code>courses</code> column and it is <strong>ignored</strong>. What
        somebody is on is decided by the cohort they are in — set that in Cohorts.
      </p>

      <!-- Named before anything is sent, because a cohort created by a typo splits a class
           in two and looks like nothing at all afterwards. -->
      <p v-if="creating.length && !results" class="creating">
        This will create {{ creating.length === 1 ? 'a new cohort' : creating.length + ' new cohorts' }}:
        <strong>{{ creating.join(', ') }}</strong>. Check the spelling — an existing cohort
        would have been matched by name.
      </p>

      <!-- Not a blocker: inviting a class before its course has been decided is a real
           order of doing things. But an empty grid is what it looks like to them, and there
           is nothing else on this screen that would say so. -->
      <p v-if="onNothing && !results" class="creating soft">
        {{ onNothing }} of these {{ onNothing === 1 ? 'person joins a cohort that takes' : 'people join cohorts that take' }}
        no course yet, so {{ onNothing === 1 ? 'they' : 'they' }} will sign in to an empty
        grid. Give the cohort a course in Cohorts — before or after this import.
      </p>

      <template v-if="rows.length && !results">
        <h3>{{ rows.length }} row{{ rows.length === 1 ? '' : 's' }}<span
          v-if="blocked.length" class="warn"> — {{ blocked.length }} will be skipped</span></h3>
        <div class="tablewrap">
          <table>
            <thead><tr><th>Line</th><th>Email</th><th>Name</th><th>Cohort</th><th>Will be on</th><th>Admin</th></tr></thead>
            <tbody>
              <tr v-for="r in decorated" :key="r.line" :class="{ bad: r.blocked }">
                <td class="num">{{ r.line }}</td>
                <td>{{ r.email || '—' }}
                  <small v-if="r.problem" class="why">{{ r.problem }}</small>

                </td>
                <td>{{ r.name || '—' }}</td>
                <td><span v-if="!r.cohortsOn.length" class="dim">—</span>
                  <span v-for="c in r.cohortsOn" :key="c.id" :class="{ fresh: c.fresh }">{{ c.title }}</span>
                </td>
                <!-- DERIVED, and the column the tutor is really reading: the file says which
                     class, and this says what that class is taking. -->
                <td><span v-if="!r.enrol.length" class="dim">nothing yet</span>{{ r.enrol.map(id => (courses.find(c => c.id === id) || {}).title || id).join(', ') }}</td>
                <td>{{ r.admin ? 'yes' : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-if="results">
        <h3>{{ running ? 'Importing…' : summary }}</h3>
        <ul class="results">
          <li v-for="(r, i) in results" :key="i" :class="{ bad: !r.ok }">
            <span class="mark">{{ r.ok ? '✓' : '✕' }}</span>
            <span class="addr">{{ r.email }}</span>
            <span class="msg">{{ r.message }}</span>
          </li>
        </ul>
      </template>

      <footer>
        <button class="btn ghost" type="button" :disabled="running"
                @click="results && !running ? emit('done', summary) : emit('close')">
          {{ results && !running ? 'Done' : 'Cancel' }}
        </button>
        <button v-if="!results" class="btn primary" type="button"
                :disabled="!usable.length || running" @click="run">
          Invite {{ usable.length }} user{{ usable.length === 1 ? '' : 's' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--ice-scrim); z-index: 60;
         display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px; overflow: auto; }
.dialog { width: min(760px, 100%); background: var(--ice-bg); border: 1px solid var(--ice-border);
          border-radius: var(--ice-radius); padding: 22px 24px 24px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
h2 { margin: 0; font-size: 18px; }
.x { background: none; border: 0; color: var(--ice-fg-muted); font-size: 15px; cursor: pointer; padding: 4px 6px; }
.lead { margin: 0 0 18px; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.6; }
.lead code { font-family: var(--ice-font-mono); font-size: .9em; background: var(--ice-code-bg);
             border: 1px solid var(--ice-border); border-radius: 4px; padding: 1px 5px; }

.pickrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.file { position: relative; overflow: hidden; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 100px; }
.filename { font-size: 13px; color: var(--ice-fg-muted); font-family: var(--ice-font-mono); }

.assignbox { border: 1px solid var(--ice-border); border-radius: 8px;
             background: var(--ice-bg-soft); padding: 12px 14px; margin-bottom: 16px; }
.note { margin: 10px 0 0; font-size: 11.5px; color: var(--ice-fg-muted); }
.assignbox input[type=text] { width: 100%; font: inherit; font-size: 14px; padding: 8px 11px;
  background: var(--ice-bg); color: var(--ice-fg);
  border: 1px solid var(--ice-border); border-radius: 8px; }
.assignbox input[type=text]:focus { outline: none; border-color: var(--ice-primary); }
/* Amber rather than red: creating a cohort is the ordinary path, and this is the one
   sentence that makes a typo visible before it happens rather than a refusal. */
.creating.soft { color: var(--ice-fg-muted); }
.creating { margin: -6px 0 16px; font-size: 12.5px; line-height: 1.55;
            color: var(--ice-fg); background: var(--ice-bg-soft);
            border: 1px solid var(--ice-border); border-left: 3px solid var(--ice-primary);
            border-radius: 8px; padding: 10px 12px; }
td .fresh { color: var(--ice-primary-strong); }
td span + span::before { content: ', '; color: var(--ice-fg-muted); }
.note code { font-family: var(--ice-font-mono); font-size: .92em; }
label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ice-fg-muted); margin-bottom: 8px; }
.courses { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.tick { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0;
        font-size: 13.5px; color: var(--ice-fg); margin: 0; cursor: pointer; }
.tick input { accent-color: var(--ice-primary); width: 15px; height: 15px; }

h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--ice-fg-muted); margin: 20px 0 8px; }
.warn { color: var(--ice-bad); }
.tablewrap { overflow: auto; max-height: 320px; border: 1px solid var(--ice-border);
             border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th { position: sticky; top: 0; background: var(--ice-bg-soft); text-align: left;
     font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--ice-fg-muted);
     padding: 8px 12px; border-bottom: 1px solid var(--ice-border); }
td { padding: 7px 12px; border-bottom: 1px solid var(--ice-border); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
tr.bad { background: var(--ice-bad-fill); }
.num { color: var(--ice-fg-muted); font-family: var(--ice-font-mono); font-size: 12px; }
.dim { color: var(--ice-fg-muted); }
.why { display: block; color: var(--ice-bad); font-size: 11.5px; }

.results { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow: auto;
           border: 1px solid var(--ice-border); border-radius: 8px; }
.results li { display: flex; align-items: baseline; gap: 10px; padding: 7px 12px; font-size: 13px;
              border-bottom: 1px solid var(--ice-border); }
.results li:last-child { border-bottom: 0; }
.mark { color: var(--ice-good); width: 12px; flex: none; }
.results li.bad .mark { color: var(--ice-bad); }
.addr { flex: 1; }
.msg { color: var(--ice-fg-muted); font-size: 12px; }
.results li.bad .msg { color: var(--ice-bad); }

.err { color: var(--ice-bad); font-size: 13px; }
footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
