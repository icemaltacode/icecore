<script setup>
/* Managing the cohorts themselves: deliver live to one, rename one, finish one, remove one.
 *
 * A SECTION rather than a dialog, which is what it started as. The difference is not
 * cosmetic: a modal is something you open, do one thing in and dismiss, and this is a place
 * you can be - `#/admin/cohorts` addresses it, the nav shows you are in it, and it will
 * carry a cohort's own page when there is one. A dialog cannot hold that.
 *
 * IT CREATES COHORTS NOW, and it did not. The old reasoning was that a cohort is named at
 * the moment somebody is put in one - in UserDialog, or in the import - because that is when
 * a tutor knows what to call it, so a form here would be a second place to invent an empty
 * one. What changed is that a cohort carries its courses: setting a class up before anybody
 * is in it is the ordinary first step now rather than an odd thing to want, and an intake
 * invented by an import lands with no courses and puts its people on nothing.
 *
 * COURSES ARE SET HERE AND NOWHERE ELSE. This is the whole of enrolment - a course reaches a
 * student through the intake they are in - which is why it is a control on the row rather
 * than a page of its own, and why the row says what each cohort takes even when it takes
 * nothing.
 *
 * ARCHIVING IS THE ORDINARY END OF AN INTAKE, not deleting. It keeps the grouping and its
 * statistics and takes it out of the pickers; a training company accumulates classes, and
 * a picker holding forty dead ones is a picker nobody reads.
 *
 * LIVE IS FIRST AND IT IS THE ONLY PRIMARY BUTTON. The other three are things you do to a
 * cohort a handful of times in its life - rename it once, archive it at the end - and they
 * sat in the row as equals, which made a screen of four link-buttons where the one thing
 * you came to do was indistinguishable from the one that deletes. They are behind a menu
 * now, which is also what makes room for Live to be a button rather than a fifth link.
 *
 * A DISABLED LIVE BUTTON ALWAYS SAYS WHY. There are four reasons and none of them is
 * guessable from the row - a greyed primary button with no explanation reads as the feature
 * being broken rather than as this cohort not being ready. `whyNotLive` in delivery.js is
 * the one definition, because the live screen has to agree with this one about it.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api } from '../auth.js';
import { live as running, refreshRunning, whyNotLive, mineAlready, end as endLive } from '../delivery.js';
import Icon from './Icon.vue';
import LiveStart from './LiveStart.vue';
import CoursePicker from './CoursePicker.vue';

const props = defineProps({
  cohorts: Array,
  /** Every user, so a member count is a tally of what the listing already carried. */
  users: Array,
  /** The catalogue, for naming the courses a cohort shares. */
  courses: Array,
});
const emit = defineEmits(['done']);

const busy = ref('');
const error = ref('');
const renaming = ref('');
const title = ref('');
const confirming = ref('');
/* The row whose course list is open, and the set being edited in it. Held apart from the
 * cohort so that cancelling leaves the row as it was - the list is only what the API says it
 * is once it has said so. */
const choosing = ref('');
/* AN ARRAY RATHER THAN A SET, because it is a `v-model` now and the picker proposes whole
 * lists rather than mutations. It is also what the API takes, so nothing has to convert on
 * the way out. */
const chosen = ref([]);
/* Naming a new intake. Closed until asked for: a create field that is always open is one
 * somebody types into by accident on a screen whose other rows are destructive. */
const creating = ref(false);
const fresh = ref('');
/* WHAT A NEW INTAKE WILL TAKE, chosen before it exists. Naming a class and then having to
 * find it in the list below to say what it is on was two steps for one decision - and the
 * second is the one people skip, which leaves an intake whose members are on nothing. */
const freshCourses = ref([]);
/* Ending a lesson from HERE rather than from the live screen. The recovery path, not the
 * ordinary one - see the menu item below. */
const finishing = ref('');
const menu = ref('');
const starting = ref(null);   // the cohort whose course picker is open

/* Who is delivering right now, asked once when the screen opens. Not polled: a session
 * starting elsewhere while this list is on screen is not a state anyone is waiting on, and
 * the conditional write refuses a collision anyway - the button is an explanation, not a
 * guard. */
onMounted(() => refreshRunning().catch(() => {}));

const counts = computed(() => {
  const n = {};
  for (const u of props.users || []) for (const c of u.cohorts || []) n[c] = (n[c] || 0) + 1;
  return n;
});

const listed = computed(() => [...(props.cohorts || [])]
  .sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.title.localeCompare(b.title)));

const why = c => whyNotLive(c, props.users);
const mine = c => mineAlready(c.id);
const held = c => running.running[c.id];
const courseTitle = id => (props.courses || []).find(x => x.id === id)?.title || id;
/** The courses a cohort takes, named, for a sentence. */
const courseTitles = c => (c.courses || []).map(courseTitle).join(' and ');

async function run(label, fn) {
  error.value = ''; busy.value = label;
  try { emit('done', await fn()); }
  catch (e) { error.value = e.message; }
  finally { busy.value = ''; }
}

const startRename = c => { menu.value = ''; renaming.value = c.id; title.value = c.title; };

const startCourses = c => {
  menu.value = '';
  choosing.value = c.id;
  chosen.value = [...(c.courses || [])];
};

/* THE WHOLE DESIRED SET, so a course unticked is a course withdrawn from everybody in the
 * class. Reported in terms of the people rather than the cohort, because the gesture that
 * takes access away looks exactly like the one that grants it. */
const setCourses = c => run('courses', async () => {
  const want = [...chosen.value];
  await api('admin/cohorts', { method: 'PUT', body: { id: c.id, courses: want } });
  choosing.value = '';
  const n = counts.value[c.id] || 0;
  const who = n === 1 ? '1 person' : `${n} people`;
  return want.length
    ? `${c.title} takes ${want.map(courseTitle).join(', ')}. ${who} can open ${want.length === 1 ? 'it' : 'them'}.`
    : `${c.title} takes no course. ${who} can open nothing until it does.`;
});

const create = () => run('create', async () => {
  const named = fresh.value.trim();
  const want = [...freshCourses.value];
  const r = await api('admin/cohorts', { method: 'POST', body: { title: named, courses: want } });
  creating.value = false;
  fresh.value = '';
  freshCourses.value = [];
  /* Naming one that already exists is not an error on the API's side - it hands back the one
   * that is there - so this says which of the two happened rather than claiming to have made
   * something it found.
   *
   * AND THE COURSES ARE NOT APPLIED TO IT. A create that quietly rewrote what an existing
   * intake takes would be the one gesture on this screen that withdraws a course from a
   * class without saying so - the second half of the sentence exists to send somebody to the
   * row, where taking one away is stated in terms of the people it happens to. */
  if (!r.created) return `${r.cohort.title} already exists. Its courses are unchanged - use its own row to change them.`;
  return want.length
    ? `${r.cohort.title} created, taking ${want.map(courseTitle).join(', ')}. Add people to it.`
    : `${r.cohort.title} created. Give it a course, then add people to it.`;
});

const rename = c => run('save', async () => {
  await api('admin/cohorts', { method: 'PUT', body: { id: c.id, title: title.value.trim() } });
  renaming.value = '';
  return `Renamed to ${title.value.trim()}.`;
});

const setArchived = (c, archived) => run(c.id, async () => {
  menu.value = '';
  await api('admin/cohorts', { method: 'PUT', body: { id: c.id, archived } });
  return archived ? `${c.title} archived.` : `${c.title} is active again.`;
});

/**
 * End somebody's live session from the cohort list.
 *
 * THE RECOVERY PATH, NOT THE ORDINARY ONE. Ending normally happens on the live screen, which
 * knows where the class got to and shows the summary afterwards. This exists for the case
 * that screen is unavailable - a laptop that closed, a browser that crashed, a bug on the
 * screen itself - where the alternative is a cohort whose lock is held until the `ttl` a day
 * later and a class that cannot be taught in the meantime.
 *
 * NO POSITION IS SENT, deliberately: this side does not know where the lesson is. The Lambda
 * falls back to the position the session row carries, which the educator's own moves keep up
 * to date - so the bookmark still lands, just without this client having to invent it.
 *
 * The refusal is the Lambda's own sentence. Somebody else's running session with people
 * connected to it is not ours to end, and the message names who to ask.
 */
const finish = c => run('end', async () => {
  const s = await endLive(c.id);
  finishing.value = '';
  const at = s?.mark?.title || s?.mark?.exercise;
  return `${c.title} is no longer live.`
    + (at ? ` The next session opens on ${at}.` : ' No bookmark was moved.');
});

const destroy = c => run('delete', async () => {
  const r = await api(`admin/cohorts?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
  confirming.value = '';
  return `${c.title} deleted. ${r.removed} ${r.removed === 1 ? 'person is' : 'people are'} no longer in it, and no longer on its courses. Nothing else about them changed.`;
});

/* One listener for the whole list rather than one per row: two of them would each have to
 * know not to close the other's opening click, which is how a menu ends up refusing to
 * open. Same shape as the two dropdowns in TopBar. */
const shut = e => { if (!e.target.closest('.menuwrap')) menu.value = ''; };
onMounted(() => addEventListener('click', shut));
onUnmounted(() => removeEventListener('click', shut));
</script>

<template>
  <section class="cohorts">
    <!-- The full width of the card. It was clamped to 60ch, which on this screen left a
         column of prose down the left and a lot of nothing beside it. -->
    <p class="lead">A cohort is a class or an intake — a group of people. <strong>What a
      cohort takes is what its people are on</strong>: put somebody in a class and they get
      its courses, take them out and they lose them. Delivering live puts everyone in a
      cohort on the same page of the same course, in real time.</p>

    <p v-if="error" class="err">{{ error }}</p>

    <!-- Name it, then give it courses, then put people in it. In that order, which is why
         creating one is a button here and not only a side effect of an import. -->
    <div class="make">
      <template v-if="creating">
        <div class="new">
          <input v-model="fresh" type="text" placeholder="Sept 2026 evening"
                 @keydown.enter.prevent="fresh.trim() && create()">
          <!-- The courses come with the name, because they are the same decision. An intake
               created with none is a class whose grid is empty, and the step that fills it
               is the one nobody comes back for. -->
          <label class="what">What it takes</label>
          <CoursePicker v-model="freshCourses" :courses="courses" :disabled="!!busy" />
          <div class="go">
            <button class="btn primary" type="button" :disabled="!fresh.trim() || !!busy"
                    @click="create">{{ busy === 'create' ? 'Creating…' : 'Create' }}</button>
            <button class="link" type="button"
                    @click="creating = false; fresh = ''; freshCourses = []">Cancel</button>
          </div>
        </div>
      </template>
      <button v-else class="btn" type="button" @click="creating = true">New cohort</button>
    </div>

    <ul class="list">
      <li v-for="c in listed" :key="c.id" :class="{ off: c.archived }">
        <template v-if="renaming === c.id">
          <input v-model="title" type="text" @keydown.enter.prevent="rename(c)">
          <button class="btn" type="button" :disabled="!title.trim() || !!busy" @click="rename(c)">Save</button>
          <button class="link" type="button" @click="renaming = ''">Cancel</button>
        </template>
        <template v-else-if="finishing === c.id">
          <!-- Said in terms of the people in it, because that is what ending a lesson does
               to them - and the bookmark is the part that makes it safe. -->
          <span class="warn">End this live session? Everyone following it goes back to
            working on their own, and the class's place is kept for next time.</span>
          <button class="btn danger" type="button" :disabled="!!busy" @click="finish(c)">End session</button>
          <button class="link" type="button" @click="finishing = ''">Cancel</button>
        </template>
        <template v-else-if="choosing === c.id">
          <!-- Inline like the rename: this is a row-level edit, and a dialog for it would
               be a dialog nobody wants. THE SAME CONTROL THE CREATE FLOW USES - two
               spellings of one choice is how the two end up disagreeing about it. -->
          <div class="picking">
            <strong>What {{ c.title }} takes</strong>
            <CoursePicker v-model="chosen" :courses="courses" :disabled="!!busy" />
            <p class="note">Everyone in this cohort is on what is listed. Removing one takes
              that course away from all {{ counts[c.id] || 0 }} of them; their progress is
              kept.</p>
          </div>
          <button class="btn primary" type="button" :disabled="!!busy" @click="setCourses(c)">
            {{ busy === 'courses' ? 'Saving…' : 'Save' }}</button>
          <button class="link" type="button" @click="choosing = ''">Cancel</button>
        </template>
        <template v-else-if="confirming === c.id">
          <!-- Said in full, because "delete" beside a list of students reads as deleting
               students and this is the one destructive verb here that is not. -->
          <!-- IT NOW TAKES THE COURSES AWAY, which it did not while enrolment was its own
               row, so the sentence had to change with the model. Their progress survives and
               comes back if they are put in another intake that takes it - the account and
               the work are what "none of the people" always meant, and still does. -->
          <span class="warn">Delete this cohort? The
            {{ counts[c.id] || 0 }} {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }} in it
            keep their account and their progress, but lose access to
            {{ (c.courses || []).length ? courseTitles(c) : 'its courses' }} until they are
            put in another cohort that takes {{ (c.courses || []).length === 1 ? 'it' : 'them' }}.
            Archive it instead to end an intake without that.</span>
          <button class="btn danger" type="button" :disabled="!!busy" @click="destroy(c)">Delete</button>
          <button class="link" type="button" @click="confirming = ''">Cancel</button>
        </template>
        <template v-else>
          <div class="who">
            <strong>{{ c.title }}</strong>
            <small><code>{{ c.id }}</code> · {{ counts[c.id] || 0 }}
              {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }}<template v-if="c.archived"> · archived</template><template
                v-if="held(c)"> · <span class="on">live now — {{ courseTitle(held(c).course) }}</span></template></small>
            <!-- ON THE ROW RATHER THAN BEHIND THE MENU, because it is now the most important
                 fact about a cohort: it is what its members can open. An intake taking
                 nothing is the state that most needs saying, so it says it. -->
            <small class="takes">
              <template v-if="(c.courses || []).length">
                <span v-for="id in c.courses" :key="id" class="course">{{ courseTitle(id) }}</span>
              </template>
              <button v-else type="button" class="link empty" @click="startCourses(c)">
                No course yet — nobody in it can open anything</button>
            </small>
          </div>

          <div class="acts">
            <!-- Ours is not a refusal but the way back in, so it says Rejoin and stays
                 enabled. Somebody else's is a refusal, and the tooltip names them. -->
            <span class="tipwrap">
              <button class="btn primary" type="button"
                      :disabled="!!why(c) && !mine(c)"
                      @click="starting = c">
                <Icon name="live" :size="14" />{{ mine(c) ? 'Rejoin' : 'Live' }}
              </button>
              <span v-if="why(c) && !mine(c)" class="tip">{{ why(c) }}</span>
            </span>

            <span class="menuwrap">
              <button class="iconbtn" type="button" :class="{ open: menu === c.id }"
                      :aria-expanded="menu === c.id" title="More"
                      @click="menu = menu === c.id ? '' : c.id">
                <Icon name="more" :size="16" />
              </button>
              <ul v-if="menu === c.id" class="menu">
                <!-- FIRST, AND ONLY WHILE ONE IS RUNNING. It is the most consequential thing
                     in this menu for exactly as long as it is there, and absent the rest of
                     the time rather than disabled: a cohort that is not live has no session
                     to end and no explanation to give. -->
                <li v-if="held(c)"><button type="button" class="danger"
                        @click="menu = ''; finishing = c.id">End session</button></li>
                <li v-if="held(c)" class="rule"></li>
                <li><button type="button" @click="startCourses(c)">Courses</button></li>
                <li><button type="button" @click="startRename(c)">Rename</button></li>
                <li><button type="button" :disabled="!!busy" @click="setArchived(c, !c.archived)">
                  {{ c.archived ? 'Restore' : 'Archive' }}</button></li>
                <li class="rule"></li>
                <li><button type="button" class="danger"
                            @click="menu = ''; confirming = c.id">Delete</button></li>
              </ul>
            </span>
          </div>
        </template>
      </li>
      <li v-if="!listed.length" class="none">No cohorts yet. Name one when you add or import
        somebody, and it appears here.</li>
    </ul>

    <!-- The head count is passed rather than recomputed there: this list already says
         "8 people in it" beside the cohort, and a dialog opening on top of it with a
         different number is worse than one with no number at all. -->
    <LiveStart v-if="starting" :cohort="starting" :courses="courses"
               :people="counts[starting.id] || 0"
               @close="starting = null" />
  </section>
</template>

<style scoped>
.lead { margin: 0 0 18px; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.6; }
.err { color: var(--ice-bad); font-size: 13px; margin: 0 0 12px; }

.list { list-style: none; margin: 0 0 18px; padding: 0;
        border: 1px solid var(--ice-border); border-radius: 8px; }
.list li { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
           border-bottom: 1px solid var(--ice-border); font-size: 14px; }
.list li:last-child { border-bottom: 0; }
.list li.off { opacity: .6; }
.list li.none { color: var(--ice-fg-muted); font-size: 13px; display: block; line-height: 1.5; }
.who { flex: 1; min-width: 0; }
.who strong { font-weight: 500; display: block; }
.who small { color: var(--ice-fg-muted); font-size: 12px; }
.who code { font-family: var(--ice-font-mono); font-size: .92em; }
.who .on { color: var(--ice-primary-strong); font-weight: 500; }
.warn { flex: 1; font-size: 12.5px; color: var(--ice-bad); line-height: 1.45; }
input[type=text] { flex: 1; font: inherit; font-size: 14px; padding: 7px 10px;
                   background: var(--ice-bg); color: var(--ice-fg);
                   border: 1px solid var(--ice-border); border-radius: 8px; }
input:focus { outline: none; border-color: var(--ice-primary); }

.make { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; }
.make input { flex: 1; max-width: 340px; font: inherit; font-size: 14px; padding: 7px 10px;
              background: var(--ice-bg); color: var(--ice-fg);
              border: 1px solid var(--ice-border); border-radius: 8px; }
/* Naming it and saying what it takes is one form, so it is a stack rather than the row the
   name alone used to be. Held to the width of a reading column: the picker's list is short
   lines, and a filter box the width of the screen looks like a search over the whole page. */
.new { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 420px;
       padding: 14px; border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
       background: var(--ice-bg-soft); }
.new input { max-width: none; }
.new .what { font-size: 12px; color: var(--ice-fg-muted); margin-bottom: -4px; }
.new .go { display: flex; align-items: center; gap: 8px; }

/* What it takes, under the name. Chips rather than prose: a cohort on three courses is a
   list, and a comma-separated sentence at 12px is one nobody parses at a glance. */
.takes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.takes .course { font-size: 11.5px; padding: 1px 7px; border-radius: 5px;
                 background: var(--ice-primary-soft); border: 1px solid var(--ice-primary);
                 color: var(--ice-fg); }
/* The empty state is a BUTTON, because it names a thing to fix and the fix is one click
   away. A greyed sentence saying the same words would be a dead end. */
.takes .empty { font-size: 11.5px; color: var(--ice-bad); }

/* Held to a reading column rather than filling the row: the picker's list is short lines,
   and its own list scrolls, so a row that grew to the height of the catalogue would push the
   Save button it belongs to off the bottom of the screen. */
.picking { flex: 1; min-width: 0; max-width: 420px; }
.picking > strong { display: block; font-weight: 500; font-size: 13px; margin-bottom: 6px; }
.picking .note { margin: 6px 0 0; font-size: 12px; color: var(--ice-fg-muted); line-height: 1.45; }

.acts { display: flex; align-items: center; gap: 8px; flex: none; }
.iconbtn { display: inline-flex; padding: 6px; border-radius: 6px; cursor: pointer;
           background: none; border: 1px solid transparent; color: var(--ice-fg-muted); }
.iconbtn:hover, .iconbtn.open { color: var(--ice-fg); border-color: var(--ice-border);
                                background: var(--ice-bg-soft); }

/* Same geometry and the same anchoring as TopBar's menus: they are the same gesture, and a
   dropdown that opens differently in two places reads as two different controls. */
.menuwrap { position: relative; }
.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
        list-style: none; margin: 0; padding: 4px; min-width: 150px;
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
        border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
.menu li { display: block; padding: 0; border: 0; }
.menu button { display: flex; align-items: center; gap: 8px; width: 100%; font: inherit;
               font-size: 13px; text-align: left; padding: 7px 9px; border-radius: 7px;
               background: none; border: 0; color: var(--ice-fg); cursor: pointer;
               white-space: nowrap; }
.menu button:hover { background: var(--ice-raise); }
.menu button.danger { color: var(--ice-bad); }
.menu .rule { height: 1px; background: var(--ice-border); margin: 4px 6px; }

/* The tooltip is on a wrapper rather than the button, because a disabled button fires no
   pointer events and so can never show one of its own. */
.tipwrap { position: relative; display: inline-flex; }
.tipwrap:hover .tip, .tipwrap:focus-within .tip { opacity: 1; visibility: visible; }
.tip { position: absolute; top: calc(100% + 8px); right: 0; z-index: 50; width: max-content;
       max-width: 280px; padding: 7px 10px; border-radius: 8px; font-size: 12px;
       line-height: 1.45; background: var(--ice-fg); color: var(--ice-bg);
       opacity: 0; visibility: hidden; transition: opacity .12s; }
.tip:after { content: ''; position: absolute; top: -4px; right: 22px; width: 9px; height: 9px;
             background: var(--ice-fg); transform: rotate(45deg); }
</style>
