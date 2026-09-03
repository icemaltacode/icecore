<script setup>
/* Managing the cohorts themselves: deliver live to one, rename one, finish one, remove one.
 *
 * A SECTION rather than a dialog, which is what it started as. The difference is not
 * cosmetic: a modal is something you open, do one thing in and dismiss, and this is a place
 * you can be - `#/admin/cohorts` addresses it, the nav shows you are in it, and it will
 * carry a cohort's own page when there is one. A dialog cannot hold that.
 *
 * Deliberately a small screen with no way to create anything. A cohort is named at the
 * moment somebody is put in it - in UserDialog, or in the import - because that is when a
 * tutor knows what to call it, and a create form here would be a second place to invent one
 * with nobody in it.
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
import { live as running, refreshRunning, whyNotLive, mineAlready } from '../delivery.js';
import Icon from './Icon.vue';
import LiveStart from './LiveStart.vue';

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

async function run(label, fn) {
  error.value = ''; busy.value = label;
  try { emit('done', await fn()); }
  catch (e) { error.value = e.message; }
  finally { busy.value = ''; }
}

const startRename = c => { menu.value = ''; renaming.value = c.id; title.value = c.title; };

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

const destroy = c => run('delete', async () => {
  const r = await api(`admin/cohorts?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
  confirming.value = '';
  return `${c.title} deleted. ${r.removed} ${r.removed === 1 ? 'person is' : 'people are'} no longer grouped - nobody was removed from anything else.`;
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
    <p class="lead">A cohort is a class or an intake — a group of people, not a course.
      New ones are named when you add or import somebody, which is when you know what to
      call them. Delivering live puts everyone in a cohort on the same page of the same
      course, in real time.</p>

    <p v-if="error" class="err">{{ error }}</p>

    <ul class="list">
      <li v-for="c in listed" :key="c.id" :class="{ off: c.archived }">
        <template v-if="renaming === c.id">
          <input v-model="title" type="text" @keydown.enter.prevent="rename(c)">
          <button class="btn" type="button" :disabled="!title.trim() || !!busy" @click="rename(c)">Save</button>
          <button class="link" type="button" @click="renaming = ''">Cancel</button>
        </template>
        <template v-else-if="confirming === c.id">
          <!-- Said in full, because "delete" beside a list of students reads as deleting
               students and this is the one destructive verb here that is not. -->
          <span class="warn">Remove this grouping? The
            {{ counts[c.id] || 0 }} {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }} in it
            keep their account, their courses and their progress.</span>
          <button class="btn danger" type="button" :disabled="!!busy" @click="destroy(c)">Delete</button>
          <button class="link" type="button" @click="confirming = ''">Cancel</button>
        </template>
        <template v-else>
          <div class="who">
            <strong>{{ c.title }}</strong>
            <small><code>{{ c.id }}</code> · {{ counts[c.id] || 0 }}
              {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }}<template v-if="c.archived"> · archived</template><template
                v-if="held(c)"> · <span class="on">live now — {{ courseTitle(held(c).course) }}</span></template></small>
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

    <LiveStart v-if="starting" :cohort="starting" :users="users" :courses="courses"
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
