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
import PlaygroundStart from './PlaygroundStart.vue';
import DataBrowser from './DataBrowser.vue';
import { runOn } from '../db.js';
import { dataBase } from '../content.js';
import { database, addDataset, reset as resetDb, schema } from '../playground-db.js';
import { run as runPy, addFiles, reset as resetPy, shape as pyShape,
         started as pyStarted, interpreter } from '../playground-py.js';
import { forget as forgetBrowsed } from '../playground-browse.js';

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
const RUNNABLE = ['sql', 'python'];

const languages = computed(() =>
  RUNNABLE.filter(l => props.manifest?.[l]?.sets?.length));
const LANG_KEY = 'ice-playground-lang';
const remembered = localStorage.getItem(LANG_KEY);
const language = ref(languages.value.includes(remembered) ? remembered : (languages.value[0] || 'sql'));
const py = computed(() => language.value === 'python');
watch(language, l => localStorage.setItem(LANG_KEY, l));

/* Asked on the way in, because the header switch is correct and almost invisible - a
 * two-item control in the corner of a screen whose interesting parts are all elsewhere, and
 * a student who never notices it uses half of this and never suspects the other half.
 *
 * Only when there IS a choice. One runnable language makes this a dialog with one button,
 * which is a worse way of saying nothing. */
const choosing = ref(languages.value.length > 1);
const chooseLanguage = l => { language.value = l; choosing.value = false; };

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

/* Where a borrowed file lives in the bucket. One definition, because the loader mounts it
 * and the browser reads it, and two spellings of the same path would diverge the day a
 * manifest entry gained a field. */
const urlFor = f =>
  `${dataBase(f.course)}${encodeURIComponent(f.unit)}/${encodeURIComponent(f.name)}`;
/* Working name -> URL, over every set rather than the loaded ones: the rail lists what is
 * mounted and a mounted file's set is loaded by definition, so this is only ever consulted
 * for something that is there. */
const fileUrls = computed(() => Object.fromEntries(
  (props.manifest?.python?.sets || []).flatMap(s => (s.files || [])
    .map(f => [f.as || f.name, urlFor(f)]))));

/* WHICH PANE THE BOTTOM HALF IS SHOWING. Results and Browse are the same rectangle rather
 * than two: on a laptop there is one screenful under the editor and splitting it again gives
 * two panes too short to read. A run switches back to Results by itself - pressing Run and
 * watching nothing happen, because the output landed on a hidden tab, is the failure this
 * prevents. */
const tab = ref('result');
const browsing = ref('');
/* Clicking a table in the rail is the obvious way to ask to see it, and without this the
 * rail is a list that does nothing. */
const show = t => { browsing.value = `${t.kind}:${t.name}`; tab.value = 'browse'; };

/* The editor's contents survive a reload, per language, because the alternative is losing
 * an hour of noodling to a stray refresh. localStorage rather than the server: this is a
 * sandbox, and a snippet store worth syncing is a feature that can be added on top of the
 * same shape later. */
const KEY = lang => `ice-playground-${lang}`;
const code = ref(localStorage.getItem(KEY(language.value)) || '');
watch(code, v => localStorage.setItem(KEY(language.value), v));
watch(language, lang => { code.value = localStorage.getItem(KEY(lang)) || ''; });

const result = ref(null);      // SQL: { fields, rows, affected }
const out = ref(null);         // Python: { out, error, value, figures }
const error = ref('');
const ms = ref(null);
const running = ref(false);
/* What the run is doing before it produces anything. The failure this exists to prevent is
 * a cell that sits there for six seconds while a wheel downloads and the student concludes
 * the Playground is broken. */
const status = ref('');

const loaded = computed(() => sets.value.filter(s => state.value[s.id] === 'loaded'));

/* HOW BIG A SET IS, BEFORE IT IS LOADED.
 *
 * The whole mitigation for offering a 13MB set casually is that clicking it is a decision
 * rather than a surprise - which needs the number on the button, and the player cannot know
 * it without fetching, which is exactly what the label exists to prevent. So the publish
 * stamps `bytes` onto each entry from what is actually in the bucket, and this adds them up.
 *
 * Absent is a normal state, not a broken one: a dev build never visits a bucket, and a
 * manifest published before the pipeline learned to stamp has no sizes either. Say nothing
 * rather than say zero. */
const size = set => [...(set.datasets || []), ...(set.files || [])]
  .reduce((n, r) => (r.bytes ? n + r.bytes : n), 0);
const human = n => (n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.round(n / 1024)} KB`);

/* WHAT THE SESSION CURRENTLY HOLDS, read back from the runtime rather than assumed from
 * what was loaded - so a table or a DataFrame the student made themselves shows up too.
 * Two runtimes, two answers, one rail. */
async function refresh() {
  try {
    if (py.value) {
      if (!pyStarted()) { tables.value = []; return; }
      const s = await pyShape();
      tables.value = [
        ...s.files.map(f => ({ name: f, kind: 'file', url: fileUrls.value[f] })),
        ...s.frames.map(f => ({ name: f.name, kind: 'frame', columns: f.columns, rows: f.rows })),
      ];
    } else {
      // `kind` is what the browser dispatches on, so every entry carries one - the SQL side
      // has only ever had the one and did not need to say so until now.
      tables.value = (await schema()).map(t => ({ ...t, kind: 'table' }));
    }
  } catch { tables.value = []; }
}
// The two languages have separate sessions, separate sets and separate rails; only the
// editor's contents are already handled by their own watcher.
watch(language, async () => {
  result.value = null; out.value = null; error.value = ''; ms.value = null; status.value = '';
  tables.value = [];
  await refresh();
});

async function load(set) {
  if (state.value[set.id] === 'loading' || state.value[set.id] === 'loaded') return;
  state.value = { ...state.value, [set.id]: 'loading' };
  busy.value = true;
  try {
    if (py.value) {
      /* Files land at the working directory under their `as` name, so the student writes
       * `pd.read_csv('gapminder.csv')` and never sees a unit number. Additive, like the SQL
       * side: two sets can be mounted at once. */
      await addFiles(set.files || [],
        f => `${dataBase(f.course)}${encodeURIComponent(f.unit)}/${encodeURIComponent(f.name)}`,
        { onStatus: s => { status.value = s; } });
    } else {
      // Sequentially, not in parallel: they go into one database and PGlite serialises
      // anyway, and one at a time means a failure names the dataset that caused it.
      for (const d of set.datasets) await addDataset(d.course, d.name);
    }
    state.value = { ...state.value, [set.id]: 'loaded' };
    /* A starter, but only into an empty editor. Overwriting what someone has been typing
     * because they loaded a second dataset would be the worst thing this screen could do. */
    if (set.starter && !code.value.trim()) code.value = set.starter;
    await refresh();
  } catch (e) {
    state.value = { ...state.value, [set.id]: String(e.message || e).split('\n')[0] };
  } finally {
    busy.value = false;
    status.value = '';
  }
}

async function resetAll() {
  busy.value = true;
  try {
    if (py.value) await resetPy(); else await resetDb();
    // The parsed CSVs describe files that are about to be unmounted.
    forgetBrowsed();
    state.value = {};
    result.value = null; out.value = null; error.value = ''; ms.value = null;
    await refresh();
  } finally { busy.value = false; }
}

async function run() {
  if (running.value) return;
  running.value = true;
  error.value = '';
  tab.value = 'result';
  const t0 = performance.now();
  try {
    if (py.value) {
      /* Python does not throw for a Python error - a traceback is OUTPUT, and comes back
       * inside the result beside whatever was printed before it. Only a broken interpreter
       * reaches the catch below. */
      out.value = await runPy(code.value, { onStatus: s => { status.value = s; } });
      result.value = null;
      ms.value = out.value.ms;
    } else {
      result.value = await runOn(await database(), code.value);
      out.value = null;
      ms.value = Math.round(performance.now() - t0);
    }
  } catch (e) {
    // A failed query is OUTPUT too: this screen renders what happened rather than a verdict
    // on it.
    error.value = String(e.message || e);
    result.value = null; out.value = null;
    ms.value = null;
  } finally {
    running.value = false;
    status.value = '';
    // A student's own CREATE TABLE - or their own DataFrame - belongs in the rail too, so
    // it follows every run rather than only the picker.
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
onMounted(() => {
  if (py.value) interpreter().then(refresh, () => {});
  else database().then(refresh, () => {});
});
</script>

<template>
  <div class="playground">
    <PlaygroundStart
      v-if="choosing"
      :languages="languages" :manifest="manifest" :current="language"
      @choose="chooseLanguage" @close="choosing = false" />

    <header class="pgbar">
      <strong>Playground</strong>
      <span class="sep"></span>
      <!-- Only drawn when there is a choice. One button that cannot be pressed is furniture
           that says the other language exists and is unavailable, which is not true - it is
           not offered yet. -->
      <span v-if="languages.length > 1" class="switchlabel">Language</span>
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
              <span v-if="size(s) && !state[s.id]" class="bytes">{{ human(size(s)) }}</span>
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
            <h2 class="tables">{{ py ? 'In the session' : 'Tables' }}</h2>
            <button v-for="t in tables" :key="t.kind + t.name" class="table"
                    :class="{ on: tab === 'browse' && browsing === t.kind + ':' + t.name }"
                    @click="show(t)">
              <span class="name">{{ t.name }}</span>
              <span v-if="t.kind === 'file'" class="cols">file</span>
              <span v-else-if="t.kind === 'frame'" class="cols">
                {{ t.rows.toLocaleString() }} x {{ t.columns.length }}
              </span>
              <span v-else class="cols">{{ t.columns.length }} col{{ t.columns.length === 1 ? '' : 's' }}</span>
            </button>
          </template>

          <button v-if="loaded.length || tables.length" class="reset" :disabled="busy"
                  @click="resetAll">{{ py ? 'Reset the session' : 'Reset the database' }}</button>
          <!-- Said plainly rather than glossed over. Pyodide cannot unload a module, so a
               true reset means a new interpreter: seconds, and it leaks the old one. This
               clears everything the student actually did and nothing else, and the page
               reload that WOULD start over costs nothing extra because the tab is going. -->
          <p v-if="py && (loaded.length || tables.length)" class="note reset-note">
            Clears your variables, data and plots. Imported libraries stay imported -
            reload the page to start completely fresh.
          </p>
        </aside>
      </template>

      <template #b>
        <SplitPane direction="column" storage-key="pg-work"
                   :initial="52" :min="18" :max="86" :min-px="110">
          <template #a>
            <div class="pgeditor">
              <CodeEditor v-model="code" :language="language" @run="run" />
              <div class="pgtools">
                <span class="hint">
                  <template v-if="status">{{ status }}</template>
                  <template v-else-if="py">{{ tables.length
                    ? `${tables.length} item${tables.length === 1 ? '' : 's'} in the session`
                    : 'Nothing loaded' }}</template>
                  <template v-else>{{ tables.length
                    ? `${tables.length} table${tables.length === 1 ? '' : 's'} loaded`
                    : 'Empty database' }}</template>
                </span>
                <button class="btn" :disabled="running || !code.trim()" @click="run">
                  <Icon name="run" :size="14" />
                  {{ running ? 'Running…' : 'Run' }}
                </button>
              </div>
            </div>
          </template>

          <template #b>
            <div class="pgpane">
              <div class="pgtabs" role="tablist">
                <button role="tab" :aria-selected="tab === 'result'"
                        :class="{ on: tab === 'result' }" @click="tab = 'result'">Results</button>
                <button role="tab" :aria-selected="tab === 'browse'"
                        :class="{ on: tab === 'browse' }" @click="tab = 'browse'">
                  <Icon name="table" :size="12" /> Browse
                </button>
              </div>

              <!-- v-show, not v-if: switching to Results and back must not re-read a 13MB
                   CSV or re-run a count, and the pager's position is worth keeping too. -->
              <DataBrowser v-show="tab === 'browse'" v-model="browsing" :items="tables" />

              <div v-show="tab === 'result'" class="pgresults">
                <!-- Output, not a verdict. A traceback or a Postgres error is shown here in
                     the same pane as a result set, because that is what happened. -->
                <pre v-if="error" class="err">{{ error }}</pre>

                <!-- PYTHON: four things at once, in the order they happened. Printed output,
                     then the traceback if there was one, then the value of the last
                     expression, then anything it drew. -->
                <div v-else-if="out" class="pyout">
                  <pre v-if="out.out" class="stdout">{{ out.out }}</pre>
                  <pre v-if="out.error" class="err">{{ out.error }}</pre>
                  <template v-if="out.value?.kind === 'frame'">
                    <!-- The same grid the SQL results use, deliberately: a student compares
                         the two by eye and nulls rendering differently reads as the code
                         having changed something. -->
                    <DataGrid :fields="out.value.fields" :rows="out.value.rows" :limit="500" numbered />
                    <p class="status">
                      {{ out.value.shape[0].toLocaleString() }} x {{ out.value.shape[1] }}
                      <span v-if="out.value.shape[0] > out.value.shown">· showing the first {{ out.value.shown }}</span>
                    </p>
                  </template>
                  <pre v-else-if="out.value?.kind === 'text'" class="stdout value">{{ out.value.text }}</pre>
                  <!-- Without this a student's first plot() appears to do nothing at all. -->
                  <img v-for="(f, i) in out.figures" :key="i" class="figure"
                       :src="`data:image/png;base64,${f}`" alt="Figure from your code">
                  <p v-if="!out.out && !out.error && !out.value && !out.figures.length" class="note pad">
                    Ran successfully, with nothing to show.<span class="ms">{{ ms }} ms</span>
                  </p>
                </div>

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
.switchlabel { font-size: 11px; color: var(--ice-fg-muted); }
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
/* The size sits between the name and the action, and goes once the set is loaded - it is
   there to inform the decision, and after the decision it is just noise. */
.set .bytes { margin-left: auto; font-family: var(--ice-font-mono); font-size: 9.5px;
              color: var(--ice-fg-muted); }
.set .row:has(.bytes) .mark { margin-left: 8px; }
.set .mark { margin-left: auto; font-family: var(--ice-font-mono); font-size: 9.5px;
             letter-spacing: .05em; text-transform: uppercase; color: var(--ice-fg-muted); }
.set.on { border-color: var(--ice-primary-soft); background: var(--ice-raise-soft); }
.set.on .mark { color: var(--ice-primary-strong); }
.set small { display: block; margin-top: 3px; color: var(--ice-fg-muted); font-size: 11px;
             line-height: 1.45; }
.set small.failed { color: var(--ice-bad); font-family: var(--ice-font-mono); font-size: 10.5px; }

.table { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 4px 10px;
         text-align: left; font: inherit; font-family: var(--ice-font-mono); font-size: 11.5px;
         cursor: pointer; color: var(--ice-fg); background: none; border: 0;
         border-radius: 6px; }
.table:hover { background: var(--ice-raise); }
/* Which one the browser is showing. Only while Browse is the visible tab: a highlight that
   points at a hidden pane is a claim about the screen that is not true. */
.table.on { color: var(--ice-primary-strong); background: var(--ice-raise-strong); }
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

/* RESULTS AND BROWSE SHARE ONE RECTANGLE. See the note in the script: under the editor
   there is one screenful, and splitting it again gives two panes too short to read either
   a traceback or a table. */
.pgpane { flex: 1; min-height: 0; display: flex; flex-direction: column;
          background: var(--ice-bg); }
.pgtabs { display: flex; gap: 2px; flex: none; padding: 4px 8px 0;
          border-bottom: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.pgtabs button { display: flex; align-items: center; gap: 5px; padding: 5px 11px;
                 font: inherit; font-size: 11.5px; cursor: pointer;
                 color: var(--ice-fg-muted); background: none;
                 border: 1px solid transparent; border-bottom: 0;
                 border-radius: 7px 7px 0 0; margin-bottom: -1px; }
.pgtabs button:hover { color: var(--ice-fg); }
/* The selected tab joins the pane below it: same background, and the shared border painted
   over so the two read as one surface rather than as a card sitting on another. */
.pgtabs button.on { color: var(--ice-fg); background: var(--ice-bg);
                    border-color: var(--ice-border); }

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

/* Python's pane scrolls as one document: what was printed, what went wrong, what the last
   expression was, and what it drew - in the order they happened, because that is the story
   of the run. */
.pyout { flex: 1; min-height: 0; overflow: auto; padding-bottom: 12px; }
.stdout { margin: 0; padding: 12px 14px 4px; font-family: var(--ice-font-mono);
          font-size: 12.5px; white-space: pre-wrap; color: var(--ice-fg); }
/* The value of the last expression is a result, not a side effect - given the accent so it
   does not read as more of whatever was printed above it. */
.stdout.value { color: var(--ice-primary-strong); }
.figure { display: block; max-width: 100%; height: auto; margin: 12px 14px;
          background: #fff; border-radius: var(--ice-radius); }
.reset-note { margin-top: 8px; font-size: 10.5px; }
</style>
