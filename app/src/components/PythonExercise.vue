<script setup>
/* A Python exercise, graded by DataCamp's own SCT.
 *
 * The same two-pane shape as CodingExercise and a different grader underneath. A SQL step
 * is marked by comparing its result set against values recorded at build time; a Python
 * step is marked by running `pythonwhat` over the submission in the browser - see py.js.
 * That difference is why this is a separate component rather than a branch inside the
 * other one: almost none of the SQL machinery applies (no dataset, no result grid, no
 * database to reset) and threading "is it Python" through all of it would leave two
 * exercise types tangled in one file.
 *
 * What is shared IS shared: the editor, the markdown renderer, the hint affordances and
 * the help pane are all the same components.
 */
import { ref, computed, watch } from 'vue';
import CodeEditor from './CodeEditor.vue';
import { gradePython, runPython, pythonReady } from '../py.js';
import { md } from '../md.js';
import { imageBase, appBase } from '../content.js';
import { askTutor, tutorAvailable } from '../hint.js';
import Icon from './Icon.vue';

const props = defineProps({
  courseId: String, exercise: Object, done: Boolean,
  /** What solved this exercise last time, keyed by step index. Absent until it has been. */
  saved: Object,
});
const emit = defineEmits(['solved']);

const mdx = text => md(text, {
  base: imageBase(props.courseId, props.exercise.topicId),
  apps: appBase(props.courseId, props.exercise.topicId),
});

const stepIndex = ref(0);
const code = ref('');
/* What solved each step, this time round: filled as steps pass and handed up whole when the
 * exercise completes, because that is the moment there is an answer worth keeping. A step
 * solved in a session that was abandoned half way is not a solution to anything. */
const passed = ref({});
const output = ref('');
const error = ref('');
const figures = ref([]);       // base64 PNGs of whatever the run drew
const files = ref([]);         // { name, bytes } for whatever it wrote
const verdict = ref(null);
const busy = ref(false);
const booting = ref(false);
const showHint = ref(false);
const showSolution = ref(false);
const tutor = ref(null);
const tutorError = ref('');
const tutorBusy = ref(false);
/* Their code broke rather than being wrong, so the way out is on offer: Ask AI pulses until
 * they either take it or start typing.
 *
 * THE FIRST KEYSTROKE CANCELS IT. A student who is already editing has decided what to try
 * next, and a button still asking to be pressed is then nagging them about a problem they
 * are in the middle of solving. Watching `code` covers every route in - typing, pasting,
 * Show answer - and the step-change reset below covers moving on.
 *
 * An error, not a wrong answer. Being marked incorrect is ordinary progress and needs no
 * button waving at it; a query that would not run is the case where a student can be stuck
 * without knowing why. */
const urgeHelp = ref(false);
watch(code, () => { urgeHelp.value = false; });

const steps = computed(() => props.exercise.steps || []);
const step = computed(() => steps.value[stepIndex.value] || {});
const multi = computed(() => steps.value.length > 1);

watch(() => [props.exercise.id, stepIndex.value], () => {
  /* Their own answer wins over the sample on an exercise they have already solved: coming
   * back to finished work and finding the starter code in the editor reads as the work
   * having been thrown away. */
  code.value = props.saved?.[stepIndex.value] ?? step.value.sample ?? '';
  output.value = ''; error.value = ''; verdict.value = null;
  figures.value = []; files.value = [];
  showHint.value = false; showSolution.value = false;
  tutor.value = null; tutorError.value = ''; urgeHelp.value = false;
}, { immediate: true });

watch(() => props.exercise.id, () => { stepIndex.value = 0; passed.value = {}; });

/* The first Python exercise of a session pays for the interpreter - Pyodide, then pandas
 * and whatever else the unit wants, then the grader's own wheels. Seconds, once. Said out
 * loud rather than left as a frozen button, because a student who has just pressed Run has
 * no way to tell a slow first import from a broken page. */
const wrap = async fn => {
  busy.value = true;
  booting.value = !pythonReady();
  try { return await fn(); }
  catch (e) { error.value = e.message; return null; }
  finally { busy.value = false; booting.value = false; }
};

async function doRun() {
  verdict.value = null; error.value = ''; figures.value = []; files.value = [];
  const r = await wrap(() => runPython(props.courseId, props.exercise, step.value, code.value));
  if (!r) return;
  output.value = r.output || '';
  error.value = r.error || '';
  figures.value = r.figures || [];
  files.value = r.files || [];
  if (error.value) urgeHelp.value = true;
}

async function doCheck() {
  error.value = ''; figures.value = []; files.value = [];
  const r = await wrap(() => gradePython(props.courseId, props.exercise, step.value, code.value));
  if (!r) return;
  // Whatever the submission printed is shown either way: a student who got it wrong wants
  // to see what their code actually did at least as much as one who got it right. Same for
  // the plot: being marked wrong is the moment a student most wants to see what they drew.
  output.value = r.output || '';
  figures.value = r.figures || [];
  if (r.error) { error.value = r.error; urgeHelp.value = true; }
  /* DataCamp's own feedback, and far better than anything we would write - it names the
   * argument you got wrong. It arrives as HTML with <code> in it, from the SCT, which is
   * course content and carries exactly the trust an exercise prompt does. */
  verdict.value = { pass: r.correct, reason: r.message || (r.correct ? 'Correct.' : 'Not quite.') };
  if (r.correct) {
    passed.value[stepIndex.value] = code.value;
    if (stepIndex.value < steps.value.length - 1) setTimeout(() => stepIndex.value++, 900);
    else emit('solved', props.exercise.id, { ...passed.value });
  }
}

async function askForHelp() {
  // Offer taken.
  urgeHelp.value = false;
  tutorBusy.value = true; tutorError.value = ''; tutor.value = null;
  try {
    tutor.value = await askTutor({
      course: props.courseId, exercise: props.exercise, step: step.value,
      submission: code.value,
      feedback: verdict.value && !verdict.value.pass
        ? String(verdict.value.reason).replace(/<[^>]+>/g, '') : error.value,
    });
  } catch (e) { tutorError.value = e.message; } finally { tutorBusy.value = false; }
}

function useSolution() { code.value = step.value.solution; verdict.value = null; }

/* Hand a student the file their code just wrote.
 *
 * `wb.save("report.xlsx")` lands in the interpreter's in-memory filesystem and stays there:
 * the exercise grades on the workbook object, but a unit whose whole premise is producing
 * something a manager opens in Excel is not taught by a spreadsheet nobody can open. Same
 * for the `fig.savefig()` unit, which is about saving a figure to share with someone.
 *
 * The object URL is revoked on the next tick rather than immediately - Safari abandons a
 * download whose blob is released in the same task. */
function save(file) {
  const url = URL.createObjectURL(new Blob([file.bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* Enough to tell a 2KB stub from the real thing, which is the only question being asked. */
const sizeOf = bytes => bytes.length < 1024
  ? `${bytes.length} B`
  : bytes.length < 1024 * 1024
    ? `${Math.round(bytes.length / 1024)} KB`
    : `${(bytes.length / 1024 / 1024).toFixed(1)} MB`;

const ranQuietly = computed(() =>
  !output.value && !error.value && !figures.value.length && !files.value.length);
</script>

<template>
  <div class="pyex">
    <section class="brief">
      <header>
        <h2>{{ exercise.title }}</h2>
        <span class="xp">{{ exercise.xp }} XP</span>
      </header>

      <div class="prose" v-html="mdx(exercise.prompt)"></div>

      <div class="instructions">
        <h3>
          Instructions
          <span v-if="multi" class="steps">{{ stepIndex + 1 }} / {{ steps.length }}</span>
        </h3>
        <ol v-if="multi" class="steplist">
          <li v-for="(s, i) in steps" :key="i"
              :class="{ current: i === stepIndex, past: i < stepIndex }">
            <span class="tick">{{ i < stepIndex ? '✓' : i + 1 }}</span>
            <span class="prose inline" v-html="mdx(s.instructions)"></span>
          </li>
        </ol>
        <div v-else class="prose" v-html="mdx(step.instructions)"></div>
      </div>

      <div class="help" v-if="step.hint || step.solution || tutorAvailable()">
        <div class="helpbtns">
          <button v-if="step.hint" class="btn ghost" @click="showHint = !showHint">
            <Icon name="hint" />{{ showHint ? 'Hide hint' : 'Take a hint' }}
          </button>
          <button v-if="tutorAvailable()" class="btn ghost"
                  :class="{ urge: urgeHelp, soft: urgeHelp }"
                  @click="askForHelp" :disabled="tutorBusy">
            <Icon name="ai" />{{ tutorBusy ? 'Thinking…' : 'Ask AI' }}
          </button>
          <button v-if="step.solution" class="btn ghost" @click="showSolution = !showSolution">
            <Icon :name="showSolution ? 'hidden' : 'answer'" />{{ showSolution ? 'Hide answer' : 'Show answer' }}
          </button>
        </div>
        <div v-if="showHint" class="prose hintbody" v-html="mdx(step.hint)"></div>
        <div v-if="tutor" class="prose tutorbody" v-html="mdx(tutor.hint)"></div>
        <p v-if="tutorError" class="tutorerr">{{ tutorError }}</p>
        <div v-if="showSolution" class="solution">
          <pre><code>{{ step.solution }}</code></pre>
          <button class="link" @click="useSolution">Copy into the editor</button>
        </div>
      </div>
    </section>

    <section class="work">
      <div class="editor-pane">
        <div class="tabbar"><span class="tab active">script.py</span></div>
        <CodeEditor v-model="code" language="python" @run="doRun" />
        <div class="actions">
          <span v-if="booting" class="muted kbd">Starting Python…</span>
          <span v-else-if="verdict" class="verdict prose inline"
                :class="{ pass: verdict.pass, fail: !verdict.pass }" v-html="verdict.reason"></span>
          <span v-else class="muted kbd">Cmd/Ctrl + Enter to run</span>
          <button class="btn ghost" @click="doRun" :disabled="busy">Run code</button>
          <button class="btn primary" @click="doCheck" :disabled="busy">Check answer</button>
        </div>
      </div>
      <div class="result-pane">
        <div class="tabbar"><span class="tab active">output</span></div>
        <div class="console">
          <p v-if="error" class="err">{{ error }}</p>
          <pre v-if="output">{{ output }}</pre>
          <!-- The backend is Agg, so without this a student's plot appears to do nothing. -->
          <img v-for="(f, i) in figures" :key="i" class="figure"
               :src="`data:image/png;base64,${f}`" alt="A figure your code drew">
          <div v-if="files.length" class="wrote">
            <h4>Files your code wrote</h4>
            <button v-for="f in files" :key="f.name" class="filebtn" @click="save(f)">
              <Icon name="download" :size="14" />
              <span class="fname">{{ f.name }}</span>
              <span class="fsize">{{ sizeOf(f.bytes) }}</span>
            </button>
          </div>
          <p v-if="ranQuietly" class="muted">Run your code to see its output.</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* THE ROOT CLASS IS `pyex` AND MUST STAY UNIQUE ACROSS THE APP. Vue's scoped CSS reaches a
   child component's root, so a name another component's parent also styles would silently
   lay this out as something else - see the comment in SlidesStep.vue for what that looks
   like when it happens. */
.pyex { display: grid; grid-template-columns: minmax(320px, 34%) minmax(0, 1fr); height: 100%; min-height: 0; }
.brief { overflow: auto; padding: 24px 28px; border-right: 1px solid var(--ice-border); }
.brief header { display: flex; align-items: baseline; gap: 12px; }
.brief h2 { margin: 0 0 4px; font-size: 19px; }
.xp { margin-left: auto; font-family: var(--ice-font-mono); font-size: 11px; color: var(--ice-fg-muted); }
.instructions { margin-top: 20px; }
.instructions h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em;
                   color: var(--ice-fg-muted); display: flex; gap: 8px; align-items: baseline; }
.steps { font-family: var(--ice-font-mono); font-size: 11px; }
.steplist { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.steplist li { display: flex; gap: 10px; align-items: flex-start; opacity: .5; }
.steplist li.current { opacity: 1; }
.steplist li.past { opacity: .65; }
.tick { flex: none; width: 20px; height: 20px; border-radius: 999px; display: grid;
        place-items: center; font-size: 10px; font-family: var(--ice-font-mono);
        border: 1px solid var(--ice-border); }
.steplist li.current .tick { border-color: transparent; background: var(--ice-primary-soft); }
.help { margin-top: 22px; }
.helpbtns { display: flex; gap: 8px; flex-wrap: wrap; }
.hintbody, .tutorbody { margin-top: 10px; padding: 10px 12px; border-radius: var(--ice-radius);
                        background: var(--ice-bg); border: 1px solid var(--ice-border); }
.tutorerr { color: var(--ice-bad); font-size: 12px; }
.solution { margin-top: 10px; }
.solution pre { margin: 0 0 6px; padding: 10px 12px; border-radius: var(--ice-radius);
                background: var(--ice-bg); border: 1px solid var(--ice-border); overflow-x: auto; }

.work { display: grid; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); min-height: 0; }
.editor-pane, .result-pane { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; }
.result-pane { grid-template-rows: auto minmax(0, 1fr); border-top: 1px solid var(--ice-border); }
.tabbar { display: flex; align-items: center; gap: 10px; padding: 8px 14px;
          border-bottom: 1px solid var(--ice-border); }
.tab { font-family: var(--ice-font-mono); font-size: 11px; color: var(--ice-fg-muted); }
.tab.active { color: var(--ice-fg); }
.actions { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
           border-top: 1px solid var(--ice-border); }
.actions .btn { margin-left: 0; }
.actions .btn.ghost { margin-left: auto; }
.kbd { font-family: var(--ice-font-mono); font-size: 11px; }
.verdict { font-size: 12.5px; }
.verdict.pass { color: var(--ice-good); }
.verdict.fail { color: var(--ice-bad); }
.console { overflow: auto; padding: 12px 14px; }
.console pre { margin: 0; font-family: var(--ice-font-mono); font-size: 12px; line-height: 1.55;
               white-space: pre-wrap; word-break: break-word; }
.console .err { margin: 0 0 8px; color: var(--ice-bad); font-family: var(--ice-font-mono);
                font-size: 12px; white-space: pre-wrap; }
.console .muted { color: var(--ice-fg-muted); font-size: 12px; }
/* Literal white, like a figure in prose and an embedded app: matplotlib draws for a light
   page whatever the player happens to be wearing, and a dark plate under dark axis labels
   reads as a broken chart rather than as a themed one. */
.figure { display: block; max-width: 100%; height: auto; margin: 10px 0 0;
          background: #fff; border-radius: var(--ice-radius); }
.wrote { margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.wrote h4 { flex-basis: 100%; margin: 0; font-family: var(--ice-font-mono); font-size: 11px;
            font-weight: 400; color: var(--ice-fg-muted); }
.filebtn { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
           font: inherit; font-size: 12px; color: var(--ice-fg); cursor: pointer;
           background: var(--ice-raise-soft); border: 1px solid var(--ice-border);
           border-radius: var(--ice-radius); }
.filebtn:hover { background: var(--ice-raise); border-color: var(--ice-primary); }
.filebtn .fname { font-family: var(--ice-font-mono); }
.filebtn .fsize { font-family: var(--ice-font-mono); font-size: 11px; color: var(--ice-fg-muted); }
</style>
