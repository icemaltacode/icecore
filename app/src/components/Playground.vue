<script setup>
/* The Playground: an editor, no syllabus, no marking, and a set of datasets to choose from.
 *
 * A PLATFORM FEATURE THAT APPEARS AS A COURSE. It reaches the grid the way every other
 * course does, and opening it does NOT enter the exercise walk - there are no modules,
 * units, topics or exercises, and the walk is the wrong shape for all of them. The content
 * repo behind it owns one file, `playground.json`; everything on this screen is the
 * platform's.
 *
 * NOTHING IS LOADED BY DEFAULT. The editor opens empty against an empty database. That is
 * the brief and it is also the honest default - fetching thirteen megabytes on the chance
 * someone wants it is a slow first paint for nothing - and it is what makes the picker the
 * first thing worth looking at.
 *
 * LOADING IS ADDITIVE. Film and Sport go into one database, so a student can join across
 * them. That is why the session is `exec` rather than the exercise player's cached data
 * directories: two dumps cannot be merged. See `playground-db.js`.
 *
 * A SET WHOSE COURSE IS NOT PUBLISHED IS HIDDEN, NOT BROKEN. A site may legitimately run
 * the Playground without the course a set borrows from, and that is a smaller Playground
 * rather than an error - the same rule as a course with no exercises being announced rather
 * than half-opened.
 */
import { ref, computed, watch, onMounted } from 'vue';
import CodeEditor from './CodeEditor.vue';
import DataGrid from './DataGrid.vue';
import SplitPane from './SplitPane.vue';
import Icon from './Icon.vue';
import { runOn } from '../db.js';
import { database, addDataset, reset as resetDb, schema } from '../playground-db.js';

const props = defineProps({
  /** The playground manifest, as published. */
  manifest: { type: Object, required: true },
  /** Every course id on this site, so a set borrowing from an absent one can be hidden. */
  published: { type: Array, default: () => [] },
});

/* WHAT THE PLAYER CAN ACTUALLY RUN, which is not the same as what a manifest may declare.
 * A manifest is allowed to be ahead of the platform - it is authored in another repo, on
 * another schedule - and the honest response to a language this build has no runtime for is
 * to not offer it, rather than to show a tab that apologises. Python joins this list when
 * its run path exists. */
const RUNNABLE = ['sql'];

const languages = computed(() =>
  RUNNABLE.filter(l => props.manifest?.[l]?.sets?.length));
const language = ref(languages.value[0] || 'sql');

const known = computed(() => new Set(props.published.map(c => c.id ?? c)));
/* Both shapes, because a SQL set borrows datasets and a Python set borrows files, and the
 * rule - a set whose lender is not on this site is hidden - is the same for both. */
const lenders = s => [...(s.datasets || []), ...(s.files || [])].map(d => d.course);
const sets = computed(() => (props.manifest?.[language.value]?.sets || [])
  .filter(s => lenders(s).every(c => known.value.has(c))));
const hidden = computed(() => (props.manifest?.[language.value]?.sets || []).length - sets.value.length);

/* Per set: 'loading' while it is being fetched and applied, 'loaded' once it is in, or the
 * message it failed with. A set that failed left the database untouched - the whole thing
 * applies in one implicit transaction - so the only state to undo is this. */
const state = ref({});
const tables = ref([]);
const busy = ref(false);

/* The editor's contents survive a reload, per language, because the alternative is losing
 * an hour of noodling to a stray refresh. localStorage rather than the server: this is a
 * sandbox, and a snippet store worth syncing is a feature that can be added on top of the
 * same shape later. */
const KEY = lang => `ice-playground-${lang}`;
const code = ref(localStorage.getItem(KEY(language.value)) || '');
watch(code, v => localStorage.setItem(KEY(language.value), v));
watch(language, lang => { code.value = localStorage.getItem(KEY(lang)) || ''; });

const result = ref(null);
const error = ref('');
const ms = ref(null);
const running = ref(false);

const loaded = computed(() => sets.value.filter(s => state.value[s.id] === 'loaded'));

async function refresh() {
  try { tables.value = await schema(); } catch { tables.value = []; }
}

async function load(set) {
  if (state.value[set.id] === 'loading' || state.value[set.id] === 'loaded') return;
  state.value = { ...state.value, [set.id]: 'loading' };
  busy.value = true;
  try {
    // Sequentially, not in parallel: they go into one database and PGlite serialises
    // anyway, and one at a time means a failure names the dataset that caused it.
    for (const d of set.datasets) await addDataset(d.course, d.name);
    state.value = { ...state.value, [set.id]: 'loaded' };
    /* A starter, but only into an empty editor. Overwriting what someone has been typing
     * because they loaded a second dataset would be the worst thing this screen could do. */
    if (set.starter && !code.value.trim()) code.value = set.starter;
    await refresh();
  } catch (e) {
    state.value = { ...state.value, [set.id]: String(e.message || e).split('\n')[0] };
  } finally {
    busy.value = false;
  }
}

async function resetAll() {
  busy.value = true;
  try {
    await resetDb();
    state.value = {};
    result.value = null; error.value = ''; ms.value = null;
    await refresh();
  } finally { busy.value = false; }
}

async function run() {
  if (running.value) return;
  running.value = true;
  error.value = '';
  const t0 = performance.now();
  try {
    result.value = await runOn(await database(), code.value);
    ms.value = Math.round(performance.now() - t0);
  } catch (e) {
    // A failed query is OUTPUT, not a failure state: this screen renders what happened
    // rather than a verdict on it.
    error.value = String(e.message || e);
    result.value = null;
    ms.value = null;
  } finally {
    running.value = false;
    // A student's own CREATE TABLE belongs in the table list too, so the list follows every
    // run rather than only the picker.
    await refresh();
  }
}

const rows = computed(() => result.value?.rows?.length ?? 0);

/* The keyboard hint names the platform rather than always saying Ctrl. CodeMirror's binding
 * is `Mod-Enter` and Mod IS Cmd on a Mac, so telling a Mac user to press Ctrl-Enter is
 * telling them something that does not work. */
const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';

/* Booted on mount rather than on the first Run. PGlite costs seconds and the student is
 * going to spend those seconds reading the picker; paying for it after they press Run makes
 * their first query look like the slow one. */
onMounted(() => { database().then(refresh, () => {}); });
</script>

<template>
  <div class="playground">
    <header class="pgbar">
      <strong>Playground</strong>
      <span class="sep"></span>
      <!-- Only drawn when there is a choice. One button that cannot be pressed is furniture
           that says the other language exists and is unavailable, which is not true - it is
           not offered yet. -->
      <div v-if="languages.length > 1" class="switch" role="tablist">
        <button v-for="l in languages" :key="l" role="tab" :aria-selected="l === language"
                :class="{ on: l === language }" @click="language = l">{{ l.toUpperCase() }}</button>
      </div>
    </header>

    <SplitPane class="pgbody" direction="row" storage-key="pg-rail"
               :initial="20" :min="12" :max="40" :min-px="170">
      <template #a>
        <aside class="pgrail">
          <h2>Data</h2>
          <p class="note">Nothing is loaded until you choose it. Sets stack, so you can load
            more than one and join across them.</p>

          <button v-for="s in sets" :key="s.id" class="set"
                  :class="{ on: state[s.id] === 'loaded', busy: state[s.id] === 'loading' }"
                  :disabled="state[s.id] === 'loading'"
                  @click="load(s)">
            <span class="row">
              <span class="name">{{ s.title }}</span>
              <span class="mark">{{ state[s.id] === 'loaded' ? 'loaded'
                                  : state[s.id] === 'loading' ? 'loading…' : 'load' }}</span>
            </span>
            <small v-if="s.blurb">{{ s.blurb }}</small>
            <small v-if="state[s.id] && state[s.id] !== 'loaded' && state[s.id] !== 'loading'"
                   class="failed">{{ state[s.id] }}</small>
          </button>

          <p v-if="!sets.length" class="note empty">
            Nothing to offer here - the courses these sets borrow from are not published on
            this site.
          </p>
          <p v-else-if="hidden" class="note">
            {{ hidden }} more set{{ hidden === 1 ? '' : 's' }} hidden - the course
            {{ hidden === 1 ? 'it borrows' : 'they borrow' }} from is not published here.
          </p>

          <!-- What is actually in the database, read back from it rather than assumed from
               what was loaded - so a table the student created themselves shows up too. -->
          <template v-if="tables.length">
            <h2 class="tables">Tables</h2>
            <div v-for="t in tables" :key="t.name" class="table">
              <span class="name">{{ t.name }}</span>
              <span class="cols">{{ t.columns.length }} col{{ t.columns.length === 1 ? '' : 's' }}</span>
            </div>
          </template>

          <button v-if="loaded.length || tables.length" class="reset" :disabled="busy"
                  @click="resetAll">Reset the database</button>
        </aside>
      </template>

      <template #b>
        <SplitPane direction="column" storage-key="pg-work"
                   :initial="52" :min="18" :max="86" :min-px="110">
          <template #a>
            <div class="pgeditor">
              <CodeEditor v-model="code" :language="language" @run="run" />
              <div class="pgtools">
                <span class="hint">{{ tables.length ? `${tables.length} table${tables.length === 1 ? '' : 's'} loaded` : 'Empty database' }}</span>
                <button class="btn" :disabled="running || !code.trim()" @click="run">
                  <Icon name="run" :size="14" />
                  {{ running ? 'Running…' : 'Run' }}
                </button>
              </div>
            </div>
          </template>

          <template #b>
            <div class="pgresults">
              <!-- Output, not a verdict. A traceback or a Postgres error is shown here in
                   the same pane as a result set, because that is what happened. -->
              <pre v-if="error" class="err">{{ error }}</pre>
              <p v-else-if="!result" class="note pad">
                Write something and press Run, or {{ mod }}&#8203;Enter.
              </p>
              <p v-else-if="!result.fields.length" class="note pad">
                Ran successfully<span v-if="result.affected != null">, {{ result.affected }}
                row{{ result.affected === 1 ? '' : 's' }} affected</span>.
                <span class="ms">{{ ms }} ms</span>
              </p>
              <template v-else>
                <DataGrid :fields="result.fields" :rows="result.rows" :limit="500" numbered />
                <p class="status">
                  {{ rows.toLocaleString() }} row{{ rows === 1 ? '' : 's' }}
                  <span v-if="rows > 500">· showing the first 500</span>
                  <span class="ms">{{ ms }} ms</span>
                </p>
              </template>
            </div>
          </template>
        </SplitPane>
      </template>
    </SplitPane>
  </div>
</template>


<style scoped>
.playground { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 0; }

.pgbar { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
         border-bottom: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.pgbar strong { font-size: 13px; }
.sep { flex: 1; }
.switch { display: inline-flex; border: 1px solid var(--ice-border); border-radius: 8px;
          overflow: hidden; background: var(--ice-bg); }
.switch button { padding: 4px 12px; font: inherit; font-size: 11px; letter-spacing: .04em;
                 background: none; border: 0; cursor: pointer; color: var(--ice-fg-muted); }
.switch button.on { background: var(--ice-primary-soft); color: var(--ice-fg); }

/* Every container class in here is prefixed, and that is not a naming preference. Vue's
   scoped CSS puts THIS component's scope id on a child component's ROOT element, so a bare
   `.editor` would style CodeEditor's own root - which is `class="editor"` - as well as the
   wrapper around it, and hand a CodeMirror instance `display: grid`. SlidesStep spells the
   same trap out at length. */
.pgbody { flex: 1; min-height: 0; }

.pgrail { flex: 1; min-height: 0; overflow: auto; padding: 14px 14px 20px;
        background: var(--ice-bg-soft); border-right: 1px solid var(--ice-border); }
.pgrail h2 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
           color: var(--ice-fg-muted); }
.pgrail h2.tables { margin-top: 20px; }
.note { color: var(--ice-fg-muted); font-size: 11.5px; line-height: 1.5; margin: 0 0 12px; }
.note.empty { margin-top: 8px; }

.set { display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 8px 10px;
       background: var(--ice-bg); border: 1px solid var(--ice-border); border-radius: 8px;
       color: var(--ice-fg); font: inherit; cursor: pointer; }
.set:hover:not(:disabled) { border-color: var(--ice-primary-soft); }
.set:disabled { cursor: progress; }
.set .row { display: flex; align-items: baseline; gap: 8px; }
.set .name { font-size: 13px; font-weight: 600; }
/* The state, not the action, when it is loaded - the button stays pressable because
   pressing it again is harmless, but it must not keep saying "load" once it has. */
.set .mark { margin-left: auto; font-family: var(--ice-font-mono); font-size: 9.5px;
             letter-spacing: .05em; text-transform: uppercase; color: var(--ice-fg-muted); }
.set.on { border-color: var(--ice-primary-soft); background: var(--ice-raise-soft); }
.set.on .mark { color: var(--ice-primary-strong); }
.set small { display: block; margin-top: 3px; color: var(--ice-fg-muted); font-size: 11px;
             line-height: 1.45; }
.set small.failed { color: var(--ice-bad); font-family: var(--ice-font-mono); font-size: 10.5px; }

.table { display: flex; align-items: baseline; gap: 8px; padding: 4px 10px;
         font-family: var(--ice-font-mono); font-size: 11.5px; }
.table .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.table .cols { margin-left: auto; color: var(--ice-fg-muted); font-size: 10px; }

.reset { margin-top: 16px; width: 100%; padding: 6px 8px; font: inherit; font-size: 11.5px;
         cursor: pointer; background: var(--ice-bg); color: var(--ice-fg-muted);
         border: 1px solid var(--ice-border); border-radius: 8px; }
.reset:hover:not(:disabled) { color: var(--ice-bad); border-color: var(--ice-bad-line); }
.reset:disabled { opacity: .5; cursor: progress; }

.pgeditor { flex: 1; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.pgtools { display: flex; align-items: center; gap: 10px; padding: 6px 12px;
         border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.pgtools .hint { margin-right: auto; color: var(--ice-fg-muted); font-size: 11px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; font: inherit;
       font-size: 13px; cursor: pointer; border-radius: 8px; border: 1px solid transparent;
       background: var(--ice-primary); color: var(--ice-on-primary); }
.btn:disabled { opacity: .5; cursor: default; }

.pgresults { flex: 1; min-height: 0; display: flex; flex-direction: column;
              background: var(--ice-bg); }
.pad { padding: 12px 14px; }
.ms { margin-left: 10px; font-family: var(--ice-font-mono); font-size: 10.5px;
      color: var(--ice-fg-muted); }
.status { display: flex; align-items: baseline; margin: 0; padding: 7px 14px; font-size: 11.5px;
          color: var(--ice-fg-muted); border-top: 1px solid var(--ice-border);
          background: var(--ice-bg-soft); }
.status .ms { margin-left: auto; }
.err { margin: 0; padding: 12px 14px; overflow: auto; color: var(--ice-bad);
       font-family: var(--ice-font-mono); font-size: 12.5px; white-space: pre-wrap; }
</style>
