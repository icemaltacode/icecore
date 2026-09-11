<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import EditorPane from './EditorPane.vue';
import ResultGrid from './ResultGrid.vue';
import { run, resetDb } from '../db.js';
import { grade } from '../grade.js';
import { md } from '../md.js';
import { imageBase, appBase } from '../content.js';
import { askTutor, tutorAvailable } from '../hint.js';
import Icon from './Icon.vue';
import RevealNotice from './RevealNotice.vue';
import * as store from '../progress-store.js';
import { progressId } from '../progress.js';
import { selectedCode } from '../selection.js';

const props = defineProps({
  /* REMOTE CONTROL, both directions. `frozen` makes the editor read-only for a student whose
   * screen an educator is driving - two people typing into one buffer is not a thing this can
   * do, and the band says so. `drivenCode` is what to put in it.
   *
   * `code` is emitted so the other end can SEE what was written: a student in the middle of
   * getting an exercise wrong has nothing recorded anywhere, because a progress row only ever
   * holds the code that solved one. It is the half of control that actually helps. */
  frozen: Boolean,
  drivenCode: String,
  /* THE EDUCATOR'S BUTTON, when this screen is the one being driven - `{ do, at, when }`
   * off the channel. Watched rather than called, because a component cannot be reached from
   * a socket handler and should not be: what arrives is a fact, and what to do about it is
   * this file's business, the same way `drivenCode` is. */
  pressed: Object,
  /* Where the other person's caret is, and whose it is. Passed straight through - this
   * component has no more business knowing about remote control than it does about the
   * channel, and the editor is the only thing that can draw one. */
  peerAt: { type: Number, default: null },
  /** The far end of their selection, when they have one. Travels with the caret - see below. */
  peerAnchor: { type: Number, default: null },
  peerName: String,
  /* WHAT THE EDUCATOR WROTE, for this step, as `{ code, by }` - the shared editor. It opens
   * a tab of its own rather than being written into the buffer above: nothing of the
   * student's is touched, so there is nothing to hand back when it stops. `live` says it is
   * arriving now rather than being read back from a lesson that has finished. See
   * EditorPane.vue, which owns everything about how the two are shown. */
  shared: Object,
  live: Boolean,
  /** The educator's caret, in the educator's own tab. Not `peerAt`, which is this buffer. */
  sharedAt: { type: Number, default: null },
  sharedAnchor: { type: Number, default: null },
  courseId: String, exercise: Object, done: Boolean,
  /** What solved this exercise last time, keyed by step index. Absent until it has been. */
  saved: Object,
  /** What was last in the editor here, finished or not - see progress-store.js. */
  draft: Object,
});
const emit = defineEmits(['solved', 'checked', 'editor', 'act']);   // see McqExercise

// Figures and embedded apps are named bare in the markdown - a filename, an app
// directory - and this is what turns them into URLs under the course's content.
const mdx = text => md(text, {
  base: imageBase(props.courseId, props.exercise.topicId),
  apps: appBase(props.courseId, props.exercise.topicId),
});

const stepIndex = ref(0);
const code = ref('');

/* Driven from outside. Guarded on a difference, or applying it would fire the emit below and
 * bounce the same text back to whoever sent it. */
watch(() => props.drivenCode, v => {
  if (typeof v === 'string' && v !== code.value) code.value = v;
});

/* THE TEXT AND THE CARET LEAVE TOGETHER, on one debounced emit.
 *
 * They were two events with different timing - the code debounced, the caret immediate - so
 * every keystroke sent a caret against text up to 300ms old. On the other side that is a
 * caret pointing at the wrong character, and past the end of a shorter document it is no
 * caret at all. A caret is an offset INTO a buffer; sending it apart from that buffer is
 * sending a number without its units.
 *
 * Short, because this is what somebody watching sees as "typing". Long enough that a burst
 * of keystrokes is one message rather than thirty. */
const BEAT = 160;
/* REFS RATHER THAN PLAIN LOCALS, because the Run button reads them now as well as the beat
 * below: it says whether it is about to run the selection or the file, and a label computed
 * from something Vue is not watching would go stale the moment anybody dragged. */
const cursorAt = ref(null);
/* The far end of the selection, kept beside the caret and sent on the same beat. A range is
 * two offsets into ONE buffer; sending either without the other is sending a number with no
 * units, which is the argument the caret already made against a message of its own. */
const anchorAt = ref(null);
let beat;
const sendSoon = () => {
  clearTimeout(beat);
  beat = setTimeout(
    /* The STEP travels with the text, for the caret's reason one line up: a buffer
     * belongs to a step of an exercise, and the one writer that keeps drafts outside this
     * component has no other way to know which. */
    () => emit('editor', { code: code.value, cursor: cursorAt.value, anchor: anchorAt.value,
                           step: stepIndex.value }), BEAT);
};
/* `{ head, anchor }` from the editor. An anchor equal to the head is a bare caret, and is
 * sent as null rather than as a zero-width range - the other side would draw a highlight
 * over no characters, which is a decoration that exists and cannot be seen. */
const onCursor = ({ head, anchor }) => {
  cursorAt.value = head;
  anchorAt.value = anchor === head ? null : anchor;
  sendSoon();
};

/* WHICH BUFFER A RUN IS ABOUT, reported by the pane - `{ mine, code, cursor, anchor }`.
 *
 * There are two editors on this screen now, and Run acts on whichever the student is looking
 * at: running the educator's code to see what it does is what a demonstration is FOR. Check
 * is not offered the choice - it grades a submission, and only the student's own buffer is
 * one. The same sentence `selection.js` already makes about a highlighted range. */
const active = ref({ mine: true, code: '', cursor: null, anchor: null });

/* WHAT RUN WILL RUN - the highlighted lines, or null when nothing is highlighted. See
 * selection.js, which owns every rule about it so that Run means one thing in both
 * languages. Recomputed rather than captured when the drag ends: the buffer can change
 * underneath a selection, and a range remembered against text that has moved runs
 * characters nobody chose. */
const running = computed(() =>
  selectedCode(active.value.code, active.value.cursor, active.value.anchor));
watch(code, sendSoon);
onBeforeUnmount(() => clearTimeout(beat));

/* What solved each step, this time round: filled as steps pass and handed up whole when the
 * exercise completes, because that is the moment there is an answer worth keeping. A step
 * solved in a session that was abandoned half way is not a solution to anything. */
const passed = ref({});
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
/* SHOWING THE ANSWER FORFEITS THE EXERCISE'S XP.
 *
 * Recorded per exercise rather than per step: a multi-step exercise is worth one amount, so
 * looking at any one of its answers spends it. Written before the answer appears, not after,
 * so a student who reveals and closes the tab has still spent it.
 *
 * The warning is skipped once the cost is already paid - re-opening an answer you have
 * already seen takes nothing more, and warning again would be asking a question whose answer
 * cannot change anything. */
const asked = ref(false);
const spent = computed(() => store.revealed(props.courseId).has(progressId(props.exercise.id)));

function wantAnswer() {
  if (showSolution.value) { showSolution.value = false; return; }
  if (spent.value || !store.warnOnReveal()) { doReveal(); return; }
  asked.value = true;
}

function doReveal(quiet) {
  if (quiet) store.stopRevealWarning();
  store.reveal(props.courseId, props.exercise.id);
  asked.value = false;
  showSolution.value = true;
}


const steps = computed(() => props.exercise.steps || []);
const step = computed(() => steps.value[stepIndex.value] || {});
const multi = computed(() => steps.value.length > 1);
const isMcqStep = computed(() => step.value.kind === 'mcq');

/* WHAT THE EDITOR OPENS ON, in order of authority.
 *
 *   1. a buffer being driven into it from outside - remote control, or the educator's
 *      demonstration. It arrives as a PROP, and a prop that is already set when this
 *      component mounts fires no watcher, so a drive that also MOVED the student to this
 *      exercise used to land on a fresh component that had never heard of it and showed the
 *      starter instead. The code simply never arrived.
 *   2. what was last in this editor, finished or not - see progress-store.js. The component
 *      is keyed by row, so leaving an exercise and coming back is a remount, and without
 *      this every unfinished attempt went with it. Including one an educator had just
 *      written into it, which is where it was noticed.
 *   3. what SOLVED it, so returning to finished work shows their answer and not the starter.
 *   4. the starter.
 */
const opensOn = () => {
  if (typeof props.drivenCode === 'string') return props.drivenCode;
  return props.draft?.[stepIndex.value]
      ?? props.saved?.[stepIndex.value]
      ?? step.value.sample
      ?? '';
};

// reset everything when the exercise or step changes
watch(() => [props.exercise.id, stepIndex.value], () => {
  // A multiple-choice step with no sample leaves the editor alone: the student is often
  // part-way through exploring the tables that the question is about.
  //
  // THEIR OWN ANSWER WINS OVER THE SAMPLE on an exercise they have already solved: coming
  // back to finished work and finding the starter code in the editor reads as the work
  // having been thrown away.
  if (!isMcqStep.value || step.value.sample)
    code.value = opensOn();
  result.value = null; error.value = ''; verdict.value = null;
  showHint.value = false; showSolution.value = false; picked.value = null;
  tutor.value = null; tutorError.value = ''; urgeHelp.value = false;
}, { immediate: true });

watch(() => props.exercise.id, () => { stepIndex.value = 0; passed.value = {}; });

/* RUN AND CHECK, PRESSED FROM SOMEWHERE ELSE.
 *
 * Remote control could move this screen and write into its editor, and then the two gestures
 * that make an editor an editor happened only in the educator's tab. The student watched
 * their query being typed for them and then watched nothing happen to it.
 *
 * IT RUNS HERE, against this browser's database, and records against this student's rows -
 * which is the whole reason the gesture travels rather than the result. What the educator
 * sees is their own copy; what the student sees is theirs. They can differ, and where they
 * do it is because the two databases differ, which is a real fact about the lesson rather
 * than a fault to paper over.
 *
 * ON `when`, NOT ON THE VERB. Pressing Run twice is two presses; a watcher on `do` alone
 * would see the second as nothing having changed.
 *
 * IT NAMES THE EXERCISE IT WAS PRESSED FOR and is dropped anywhere else, for the reason a
 * pushed buffer is: a drive and a press can cross, and running an instruction against the
 * exercise that happens to be on screen now is the difference between a demonstration and
 * vandalism.
 */
watch(() => props.pressed?.when, () => {
  const p = props.pressed;
  if (!p?.when || !p.do || busy.value) return;
  if (p.at != null && progressId(p.at) !== progressId(props.exercise.id)) return;
  /* A CHOICE IS NOT DRIVEN THE WAY CODE IS, so a relayed Check on a step nobody has
   * answered on THIS side would mark the student wrong for a question the educator answered
   * on theirs. Dropped rather than graded. Driving the choice itself is a real piece of work
   * and a separate one; grading an empty answer as a failure is not a smaller version of it.
   */
  if (isMcqStep.value && picked.value === null) return;
  if (p.do === 'run') doRun({ whole: true, only: p.sel || null });
  else if (p.do === 'check') doCheck();
});

/* THE SELECTION IS THE STUDENT'S, AND ONLY RUN HONOURS IT.
 *
 * Check grades a SUBMISSION. Marking somebody on the three lines they happened to have
 * highlighted would not be a smaller verdict, it would be a wrong one - and the exercise
 * would then be recorded as solved, or not, on something they never submitted.
 *
 * `whole` IS FOR A PRESS THAT CAME FROM SOMEWHERE ELSE. An educator driving this screen or
 * demonstrating to the room pressed Run against THEIR buffer; honouring a selection this
 * student happens to have left lying in a frozen editor would run something nobody asked
 * for, on a screen they cannot type in.
 *
 * `only` IS THAT PRESS SAYING WHAT IT RAN. `whole` was the whole of the answer while a press
 * could not carry a selection, and it was the wrong half of it: an educator running four
 * lines of a long query had every screen in the room run the entire file, which is a
 * different demonstration from the one they were giving. The educator's selection arrives as
 * TEXT and is run as text - offsets would be indexed against this browser's copy of the
 * buffer, which is a debounced beat behind theirs. `whole` still answers the press that
 * carries nothing, which is what makes this student's stale highlight stay ignored.
 */
async function doRun({ whole = false, only = null } = {}) {
  /* The lines this press is against, or null for the buffer: what an educator's press
   * brought with it, else what is highlighted here, else nothing. */
  const sel = only ?? (whole ? null : running.value);
  /* A PRESS FROM SOMEWHERE ELSE RUNS WHAT IT WAS PRESSED AGAINST. While a demonstration is
   * live that is the educator's version - it is the buffer they pressed Run on, and the one
   * this student is being shown. A press from somebody DRIVING this screen is the opposite
   * case: control writes into the student's own work deliberately, so that is the buffer. */
  const buffer = whole
    ? (props.live && typeof props.shared?.code === 'string' ? props.shared.code : code.value)
    : active.value.code;
  const sending = sel ?? buffer;
  /* Said out loud on every press, WITH what it ran. Only a CONTROL TAB relays it - see
   * App.vue - so a press that arrived from one does not bounce back to where it came from. */
  emit('act', 'run', sel);
  busy.value = true; error.value = ''; verdict.value = null;
  try { result.value = await run(props.courseId, props.exercise.dataset, sending, props.exercise.setup); }
  catch (e) { error.value = e.message; result.value = null; urgeHelp.value = true; }
  finally { busy.value = false; }
}

async function doCheck() {
  /* Said out loud on every press. Only a CONTROL TAB relays it - see App.vue - so a
   * press that arrived from one does not bounce back to where it came from. */
  emit('act', 'check');
  busy.value = true; error.value = '';
  try {
    const v = isMcqStep.value ? checkChoice() : await gradeQuery();
    verdict.value = v;
    emit('checked', props.exercise.id, {
      pass: !!v.pass, error: !!v.error, step: stepIndex.value,
      // Only a step that IS a choice has one; a query has no option to report.
      choice: isMcqStep.value ? picked.value : null,
    });
    if (v.error) urgeHelp.value = true;
    if (v.pass) {
      // An MCQ step has no editor and so nothing to keep - the choice is not a solution.
      if (!isMcqStep.value) passed.value[stepIndex.value] = code.value;
      if (stepIndex.value < steps.value.length - 1) setTimeout(() => stepIndex.value++, 900);
      else emit('solved', props.exercise.id, { ...passed.value });
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
  // Offer taken.
  urgeHelp.value = false;
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
  <div class="coding" :class="{ demoing: live }">
    <section class="brief" data-point="prompt">
      <header>
        <h2>{{ exercise.title }}</h2>
        <!-- Only where there is an amount. An exercise with no `xp:` in its frontmatter
             has `exercise.xp === undefined`, which Vue interpolates as an empty string -
             so this rendered a bare "XP" against nothing. Truthiness on purpose: an
             exercise explicitly worth 0 has no badge to show either. -->
        <!-- Struck through once the answer has been seen, because the amount is no
             longer what finishing this will pay. Showing it unchanged would have a student
             earn nothing from a badge still promising 100. -->
        <span v-if="exercise.xp" class="xp" :class="{ spent }"
              :title="spent ? 'The answer was shown, so this exercise no longer earns XP' : null">{{ exercise.xp }} XP</span>
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
        <div class="helpbtns">
          <button v-if="step.hint" class="btn ghost" data-show="hint" data-label="Hint"
                  @click="showHint = !showHint">
            <Icon name="hint" />{{ showHint ? 'Hide hint' : 'Take a hint' }}
          </button>
          <button v-if="tutorAvailable() && !isMcqStep" class="btn ghost"
                  data-show="ai" data-label="Ask AI"
                  :class="{ urge: urgeHelp, soft: urgeHelp }"
                  @click="askForHelp" :disabled="tutorBusy">
            <Icon name="ai" />{{ tutorBusy ? 'Thinking…' : 'Ask AI' }}
          </button>
          <button v-if="step.solution || isMcqStep" class="btn ghost" @click="wantAnswer">
            <Icon :name="showSolution ? 'hidden' : 'answer'" />{{ showSolution ? 'Hide answer' : 'Show answer' }}
          </button>
        </div>
        <RevealNotice v-if="asked" :xp="exercise.xp" @confirm="doReveal" @cancel="asked = false" />
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
        <EditorPane v-model="code" name="query.sql" :readonly="frozen"
                    :shared="shared" :live="live"
                    :shared-at="sharedAt" :shared-anchor="sharedAnchor"
                    :peer-at="peerAt" :peer-anchor="peerAnchor" :peer-name="peerName"
                    @cursor="onCursor" @active="active = $event" @run="doRun()">
          <template #right>
            <button class="link right" @click="doReset" :disabled="busy">Reset database</button>
          </template>
        </EditorPane>
        <div class="actions">
          <span v-if="verdict" class="verdict prose inline"
                :class="{ pass: verdict.pass, fail: !verdict.pass }" v-html="mdx(verdict.reason)"></span>
          <span v-else class="muted kbd">
            Cmd/Ctrl + Enter to run{{ running ? ' the selection' : '' }}
          </span>
          <!-- THE LABEL CHANGES BECAUSE THE BUTTON DOES. Running the highlighted lines is
               what every other editor does, but a button that silently ran something other
               than the file would be a surprise the student had no way to see coming -
               most sharply in Python, where the setup is there and their own earlier lines
               are not, so a selection can fail for a reason the label explains. -->
          <!-- AND IT SAYS WHOSE CODE, once there are two buffers to run. A student looking
               at the educator's tab who pressed a button labelled "Run code" would fairly
               expect their own. -->
          <button class="btn ghost" data-show="run" data-label="Run" @click="doRun()"
                  :disabled="busy">
            {{ running ? 'Run selection' : (active.mine ? 'Run code' : 'Run this version') }}
          </button>
          <button class="btn primary" data-show="check" data-label="Check answer"
                  @click="doCheck"
                  :disabled="busy || (isMcqStep && picked === null)">Check answer</button>
        </div>
      </div>
      <div class="result-pane" data-point="result">
        <div class="tabbar"><span class="tab active">query result</span></div>
        <ResultGrid :result="result" :error="error" />
      </div>
    </section>
  </div>
</template>

<style scoped>
/* NARROWER THAN IT READS ALONE, because it is not alone any more. The prompt used to face
   one editor and 34% was the comfortable share; facing two it is the column that decides
   whether the split fits at all, and every point taken off it is a point of code. Still
   floored, so a narrow window gives the instructions back rather than squeezing them to a
   word a line.

   AND IT GIVES WAY AGAIN WHILE A DEMONSTRATION IS RUNNING. A static reduction is the wrong
   shape on its own: the instructions are the most useful thing on screen when a student is
   working alone, and the least when they are watching somebody write the answer. So the
   column that yields is the one whose value drops for exactly as long as the split needs the
   room - and it comes straight back, because nothing was stored. The same reasoning as the
   shell folding its chrome, one level further in. */
.coding { display: grid; grid-template-columns: minmax(300px, 29%) minmax(0, 1fr);
         height: 100%; min-height: 0; }
.coding.demoing { grid-template-columns: minmax(260px, 21%) minmax(0, 1fr); }
.brief { overflow: auto; padding: 24px 28px; border-right: 1px solid var(--ice-border); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0 0 4px; font-size: 20px; }
.xp { color: var(--ice-primary-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
.xp.spent { color: var(--ice-fg-muted); text-decoration: line-through; }
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
.option.right { border-color: var(--ice-good-line); background: var(--ice-good-fill); }
.option.wrong { border-color: var(--ice-bad-line); background: var(--ice-bad-fill); }
.marker { flex: none; width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center;
          font-size: 11px; font-weight: 600; background: var(--ice-bg-soft); border: 1px solid var(--ice-border); }

.help { margin-top: 20px; }
.helpbtns { display: flex; flex-wrap: wrap; gap: 8px; }
.hintbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft); border-radius: var(--ice-radius); }
.solution { margin-top: 8px; }
.solution pre { margin: 0; padding: 10px 12px; background: var(--ice-bg-soft); border-radius: var(--ice-radius);
                border-left: 2px solid var(--ice-primary); overflow-x: auto; }
.solution code { font-family: var(--ice-font-mono); font-size: 13px; white-space: pre; }
.solution .link { margin-top: 6px; }
.tutorbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft);
             border-left: 2px solid var(--ice-primary); border-radius: var(--ice-radius); }
.tutorerr { margin: 8px 0 0; color: var(--ice-bad); font-size: 13px; }

.work { display: grid; grid-template-rows: 1fr minmax(140px, 38%); min-height: 0; min-width: 0; }
.editor-pane, .result-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
/* The editor pane is EditorPane's root; this only has to let it fill the row. Its own
   internals - the tab bar, the split - are its business and are scoped to it. */
.editor-pane > .pane { flex: 1; min-height: 0; }
.result-pane { border-top: 1px solid var(--ice-border); }
.tabbar { display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--ice-bg-soft);
          border-bottom: 1px solid var(--ice-border); }
.tab { font-size: 12px; padding: 9px 4px; color: var(--ice-fg-muted); }
.tab.active { color: var(--ice-fg); box-shadow: inset 0 -2px 0 var(--ice-primary); }
.right { margin-left: auto; }
.actions { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
           border-top: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.verdict { font-size: 13px; margin-right: auto; }
.verdict.pass { color: var(--ice-good); }
.verdict.fail { color: var(--ice-bad); }
.kbd { margin-right: auto; font-size: 12px; }
</style>
