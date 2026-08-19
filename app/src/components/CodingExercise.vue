<script setup>
import { ref, computed, watch } from 'vue';
import SqlEditor from './SqlEditor.vue';
import ResultGrid from './ResultGrid.vue';
import { run, resetDb } from '../db.js';
import { grade } from '../grade.js';
import { md } from '../md.js';
import { imageBase } from '../content.js';
import { askTutor, tutorAvailable } from '../hint.js';

const props = defineProps({ courseId: String, exercise: Object, done: Boolean });
const emit = defineEmits(['solved']);

// Figures are written as bare filenames in the markdown; this is what turns them
// into a URL under the course's content.
const mdx = text => md(text, { base: imageBase(props.courseId, props.exercise.topicId) });

const stepIndex = ref(0);
const code = ref('');
const result = ref(null);
const error = ref('');
const verdict = ref(null);
const busy = ref(false);
const showHint = ref(false);
const showSolution = ref(false);
const picked = ref(null);
const tutor = ref(null);        // { text } once a nudge comes back
const tutorError = ref('');
const tutorBusy = ref(false);

const steps = computed(() => props.exercise.steps || []);
const step = computed(() => steps.value[stepIndex.value] || {});
const multi = computed(() => steps.value.length > 1);
const isMcqStep = computed(() => step.value.kind === 'mcq');

// reset everything when the exercise or step changes
watch(() => [props.exercise.id, stepIndex.value], () => {
  // A multiple-choice step with no sample leaves the editor alone: the student is often
  // part-way through exploring the tables that the question is about.
  if (!isMcqStep.value || step.value.sample) code.value = step.value.sample || '';
  result.value = null; error.value = ''; verdict.value = null;
  showHint.value = false; showSolution.value = false; picked.value = null;
  tutor.value = null; tutorError.value = '';
}, { immediate: true });

watch(() => props.exercise.id, () => { stepIndex.value = 0; });

async function doRun() {
  busy.value = true; error.value = ''; verdict.value = null;
  try { result.value = await run(props.courseId, props.exercise.dataset, code.value, props.exercise.setup); }
  catch (e) { error.value = e.message; result.value = null; }
  finally { busy.value = false; }
}

async function doCheck() {
  busy.value = true; error.value = '';
  try {
    const v = isMcqStep.value ? checkChoice() : await gradeQuery();
    verdict.value = v;
    if (v.pass) {
      if (stepIndex.value < steps.value.length - 1) setTimeout(() => stepIndex.value++, 900);
      else emit('solved', props.exercise.id);
    }
  } finally { busy.value = false; }
}

function checkChoice() {
  const right = picked.value === step.value.answer;
  return {
    pass: right,
    reason: step.value.feedback?.[picked.value] || (right ? 'Correct.' : 'Not quite.'),
  };
}

async function gradeQuery() {
  const v = await grade(props.courseId, props.exercise, step.value, code.value);
  if (v.result) result.value = v.result;
  return v;
}

async function askForHelp() {
  tutorBusy.value = true; tutorError.value = ''; tutor.value = null;
  try {
    const r = await askTutor({
      course: props.courseId,
      exercise: props.exercise,
      step: step.value,
      submission: code.value,
      // What the grader last said is the most useful single clue about where they are.
      feedback: verdict.value && !verdict.value.pass ? verdict.value.reason : error.value,
    });
    tutor.value = r;
  } catch (e) {
    tutorError.value = e.message;
  } finally {
    tutorBusy.value = false;
  }
}

function useSolution() {
  if (isMcqStep.value) picked.value = step.value.answer;
  else code.value = step.value.solution;
  verdict.value = null;
}

async function doReset() {
  busy.value = true;
  try { await resetDb(props.courseId, props.exercise.dataset, props.exercise.setup); result.value = null; error.value = ''; verdict.value = null; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="coding">
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

        <ul v-if="isMcqStep" class="options">
          <li v-for="(opt, i) in step.options" :key="i">
            <button
              class="option"
              :class="{ picked: picked === i,
                        right: showSolution && i === step.answer,
                        wrong: verdict && !verdict.pass && picked === i }"
              @click="picked = i; verdict = null">
              <span class="marker">{{ String.fromCharCode(65 + i) }}</span>
              <span class="prose inline" v-html="mdx(opt)"></span>
            </button>
          </li>
        </ul>
      </div>

      <div class="help" v-if="step.hint || step.solution || isMcqStep || tutorAvailable()">
        <div class="helplinks">
          <button v-if="step.hint" class="link" @click="showHint = !showHint">
            {{ showHint ? 'Hide hint' : 'Take a hint' }}
          </button>
          <button v-if="tutorAvailable() && !isMcqStep" class="link"
                  @click="askForHelp" :disabled="tutorBusy">
            {{ tutorBusy ? 'Thinking…' : 'Ask a tutor' }}
          </button>
          <button v-if="step.solution || isMcqStep" class="link" @click="showSolution = !showSolution">
            {{ showSolution ? 'Hide answer' : 'Show answer' }}
          </button>
        </div>
        <div v-if="showHint" class="prose hintbody" v-html="mdx(step.hint)"></div>
        <div v-if="tutor" class="prose tutorbody" v-html="mdx(tutor.hint)"></div>
        <p v-if="tutorError" class="tutorerr">{{ tutorError }}</p>
        <div v-if="showSolution && !isMcqStep" class="solution">
          <pre><code>{{ step.solution }}</code></pre>
          <button class="link" @click="useSolution">Copy into the editor</button>
        </div>
      </div>
    </section>

    <section class="work">
      <div class="editor-pane">
        <div class="tabbar">
          <span class="tab active">query.sql</span>
          <button class="link right" @click="doReset" :disabled="busy">Reset database</button>
        </div>
        <SqlEditor v-model="code" @run="doRun" />
        <div class="actions">
          <span v-if="verdict" class="verdict prose inline"
                :class="{ pass: verdict.pass, fail: !verdict.pass }" v-html="mdx(verdict.reason)"></span>
          <span v-else class="muted kbd">Cmd/Ctrl + Enter to run</span>
          <button class="btn ghost" @click="doRun" :disabled="busy">Run code</button>
          <button class="btn primary" @click="doCheck"
                  :disabled="busy || (isMcqStep && picked === null)">Check answer</button>
        </div>
      </div>
      <div class="result-pane">
        <div class="tabbar"><span class="tab active">query result</span></div>
        <ResultGrid :result="result" :error="error" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.coding { display: grid; grid-template-columns: minmax(320px, 34%) minmax(0, 1fr); height: 100%; min-height: 0; }
.brief { overflow: auto; padding: 24px 28px; border-right: 1px solid var(--ice-border); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0 0 4px; font-size: 20px; }
.xp { color: var(--ice-primary-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--ice-fg-muted); margin: 24px 0 8px; }
.steps { float: right; text-transform: none; letter-spacing: 0; }
.steplist { list-style: none; margin: 0; padding: 0; }
.steplist li { display: flex; gap: 10px; padding: 8px 0; opacity: .45; border-bottom: 1px solid var(--ice-border); }
.steplist li.current { opacity: 1; }
.steplist li.past { opacity: .7; }
.tick { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
        font-size: 11px; background: var(--ice-bg-soft); border: 1px solid var(--ice-border); }
.steplist li.past .tick { background: var(--ice-primary-soft); color: var(--ice-fg); border-color: transparent; }
.steplist li.current .tick { border-color: var(--ice-primary); color: var(--ice-primary); }
.options { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 8px; }
.option { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left;
          padding: 10px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 13px;
          background: var(--ice-bg); border: 1px solid var(--ice-border); color: var(--ice-fg); }
.option:hover { border-color: var(--ice-primary-soft); }
.option.picked { border-color: var(--ice-primary); }
.option.right { border-color: #4ade80; background: rgba(74, 222, 128, .08); }
.option.wrong { border-color: #f87171; background: rgba(248, 113, 113, .08); }
.marker { flex: none; width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center;
          font-size: 11px; font-weight: 600; background: var(--ice-bg-soft); border: 1px solid var(--ice-border); }

.help { margin-top: 20px; }
.helplinks { display: flex; gap: 16px; }
.hintbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft); border-radius: var(--ice-radius); }
.solution { margin-top: 8px; }
.solution pre { margin: 0; padding: 10px 12px; background: var(--ice-bg-soft); border-radius: var(--ice-radius);
                border-left: 2px solid var(--ice-primary); overflow-x: auto; }
.solution code { font-family: var(--ice-font-mono); font-size: 13px; white-space: pre; }
.solution .link { margin-top: 6px; }
.tutorbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft);
             border-left: 2px solid var(--ice-primary); border-radius: var(--ice-radius); }
.tutorerr { margin: 8px 0 0; color: #fca5a5; font-size: 13px; }

.work { display: grid; grid-template-rows: 1fr minmax(140px, 38%); min-height: 0; min-width: 0; }
.editor-pane, .result-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.result-pane { border-top: 1px solid var(--ice-border); }
.tabbar { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--ice-bg-soft);
          border-bottom: 1px solid var(--ice-border); }
.tab { font-size: 12px; padding: 9px 4px; color: var(--ice-fg-muted); }
.tab.active { color: var(--ice-fg); box-shadow: inset 0 -2px 0 var(--ice-primary); }
.right { margin-left: auto; }
.actions { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
           border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.verdict { font-size: 13px; margin-right: auto; }
.verdict.pass { color: #86efac; }
.verdict.fail { color: #fca5a5; }
.kbd { margin-right: auto; font-size: 12px; }
</style>
