<script setup>
import { ref, computed, watch } from 'vue';
import SqlEditor from './SqlEditor.vue';
import ResultGrid from './ResultGrid.vue';
import { run, resetDb } from '../db.js';
import { grade } from '../grade.js';
import { md } from '../md.js';

const props = defineProps({ courseId: String, exercise: Object, done: Boolean });
const emit = defineEmits(['solved']);

const stepIndex = ref(0);
const code = ref('');
const result = ref(null);
const error = ref('');
const verdict = ref(null);
const busy = ref(false);
const showHint = ref(false);

const steps = computed(() => props.exercise.steps || []);
const step = computed(() => steps.value[stepIndex.value] || {});
const multi = computed(() => steps.value.length > 1);

// reset everything when the exercise or step changes
watch(() => [props.exercise.id, stepIndex.value], () => {
  code.value = step.value.sample || '';
  result.value = null; error.value = ''; verdict.value = null; showHint.value = false;
}, { immediate: true });

watch(() => props.exercise.id, () => { stepIndex.value = 0; });

async function doRun() {
  busy.value = true; error.value = ''; verdict.value = null;
  try { result.value = await run(props.courseId, props.exercise.dataset, code.value); }
  catch (e) { error.value = e.message; result.value = null; }
  finally { busy.value = false; }
}

async function doCheck() {
  busy.value = true; error.value = '';
  try {
    const v = await grade(props.courseId, props.exercise.dataset, step.value, code.value);
    verdict.value = v;
    if (v.result) result.value = v.result;
    if (v.pass) {
      if (stepIndex.value < steps.value.length - 1) setTimeout(() => stepIndex.value++, 900);
      else emit('solved', props.exercise.id);
    }
  } finally { busy.value = false; }
}

async function doReset() {
  busy.value = true;
  try { await resetDb(props.courseId, props.exercise.dataset); result.value = null; error.value = ''; verdict.value = null; }
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

      <div class="prose" v-html="md(exercise.prompt)"></div>

      <div class="instructions">
        <h3>
          Instructions
          <span v-if="multi" class="steps">{{ stepIndex + 1 }} / {{ steps.length }}</span>
        </h3>
        <ol v-if="multi" class="steplist">
          <li v-for="(s, i) in steps" :key="i"
              :class="{ current: i === stepIndex, past: i < stepIndex }">
            <span class="tick">{{ i < stepIndex ? '✓' : i + 1 }}</span>
            <span class="prose inline" v-html="md(s.instructions)"></span>
          </li>
        </ol>
        <div v-else class="prose" v-html="md(step.instructions)"></div>
      </div>

      <div class="hint" v-if="step.hint">
        <button class="link" @click="showHint = !showHint">
          {{ showHint ? 'Hide hint' : 'Take a hint' }}
        </button>
        <div v-if="showHint" class="prose hintbody" v-html="md(step.hint)"></div>
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
          <span v-if="verdict" class="verdict" :class="{ pass: verdict.pass, fail: !verdict.pass }">
            {{ verdict.reason }}
          </span>
          <span v-else class="muted kbd">Cmd/Ctrl + Enter to run</span>
          <button class="btn ghost" @click="doRun" :disabled="busy">Run code</button>
          <button class="btn primary" @click="doCheck" :disabled="busy">Check answer</button>
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
.coding { display: grid; grid-template-columns: minmax(320px, 34%) 1fr; height: 100%; min-height: 0; }
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
.hint { margin-top: 20px; }
.hintbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft); border-radius: var(--ice-radius); }

.work { display: grid; grid-template-rows: 1fr minmax(140px, 38%); min-height: 0; }
.editor-pane, .result-pane { display: flex; flex-direction: column; min-height: 0; }
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
