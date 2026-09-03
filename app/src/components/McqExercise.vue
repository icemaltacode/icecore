<script setup>
import { ref, watch } from 'vue';
import { md } from '../md.js';
import { imageBase, appBase } from '../content.js';
import Icon from './Icon.vue';

const props = defineProps({
  courseId: String, exercise: Object, done: Boolean,
  /* HOW THE CLASS ANSWERED, `{ tally: { [option]: n }, answered }`, and only ever set for a
   * tutor delivering live - the Lambda refuses to send anybody else a mark at all.
   *
   * NULL RATHER THAN AN EMPTY TALLY when it does not apply, so "nobody has answered yet" is
   * distinguishable from "this is not a live delivery": the first is worth drawing and is
   * most of what a tutor is waiting for, and the second must leave this exercise looking
   * exactly as every student sees it. */
  classAnswers: Object,
});
/* `checked` is EVERY press and `solved` is only the ones that pass. Two events rather than
 * a verdict on one, because they answer to different things: `solved` writes progress and
 * XP and must not fire twice for one earn, while a live delivery wants the wrong answers
 * most of all - "answered incorrectly" and "has not answered" are the two states a tutor
 * needs to tell apart, and nothing durable records the first. */
const emit = defineEmits(['solved', 'checked']);

// Figures and embedded apps are named bare in the markdown - a filename, an app
// directory - and this is what turns them into URLs under the course's content.
const mdx = text => md(text, {
  base: imageBase(props.courseId, props.exercise.topicId),
  apps: appBase(props.courseId, props.exercise.topicId),
});

const picked = ref(null);
const submitted = ref(false);
const showHint = ref(false);

watch(() => props.exercise.id, () => {
  picked.value = null; submitted.value = false; showHint.value = false;
});

const correct = () => picked.value === props.exercise.answer;

/* Of those who have answered, not of the class. A bar that shrank as latecomers arrived
 * would make an option look less popular for having been chosen by more people. */
const share = i => {
  const n = props.classAnswers?.answered || 0;
  return n ? Math.round(((props.classAnswers.tally[i] || 0) / n) * 100) : 0;
};

/**
 * How an option reads to an EDUCATOR, who already knows the answer.
 *
 * A student sees nothing until they submit, because a marked option is the answer. An
 * educator is looking at this to run a lesson from and is the one person in the room for
 * whom that is not a spoiler - so the correct one is green from the start, and a wrong one
 * is red as soon as somebody has actually chosen it.
 *
 * ONLY THE WRONG ONES PEOPLE CHOSE. Reddening every option that is not the answer would
 * make the picture uniform and say nothing; the point of the colour here is that it lands
 * on the misunderstanding the class has actually had.
 */
const asClass = i => {
  if (!props.classAnswers) return '';
  if (i === props.exercise.answer) return 'right';
  return props.classAnswers.tally[i] ? 'wrong' : '';
};

function submit() {
  if (picked.value === null) return;
  submitted.value = true;
  emit('checked', props.exercise.id, { pass: correct(), choice: picked.value });
  if (correct()) emit('solved', props.exercise.id);
}
</script>

<template>
  <div class="mcq">
    <div class="card">
      <header>
        <h2>{{ exercise.title }}</h2>
        <!-- Only where there is an amount. An exercise with no `xp:` in its frontmatter
             has `exercise.xp === undefined`, which Vue interpolates as an empty string -
             so this rendered a bare "XP" against nothing. Truthiness on purpose: an
             exercise explicitly worth 0 has no badge to show either. -->
        <span v-if="exercise.xp" class="xp">{{ exercise.xp }} XP</span>
      </header>

      <div class="prose" v-html="mdx(exercise.prompt)"></div>

      <ul class="options">
        <li v-for="(opt, i) in exercise.options" :key="i">
          <button
            class="option"
            :class="[{
              picked: picked === i,
              right: submitted && i === exercise.answer,
              wrong: submitted && picked === i && i !== exercise.answer,
            }, asClass(i)]"
            :disabled="submitted"
            @click="picked = i">
            <!-- INTO the option, not charted beside it. A bar chart next to the list makes a
                 tutor read across from a colour to an answer while a class waits; the number
                 belongs on the thing it is about. Behind the text rather than in front, and
                 at low opacity, because it is context and the option is the content. -->
            <span v-if="classAnswers" class="share" :class="asClass(i)"
                  :style="{ width: share(i) + '%' }"></span>
            <span class="marker">{{ String.fromCharCode(65 + i) }}</span>
            <span class="prose inline" v-html="mdx(opt)"></span>
            <span v-if="classAnswers" class="count"
                  :class="{ none: !classAnswers.tally[i] }">{{ classAnswers.tally[i] || 0 }}</span>
          </button>
        </li>
      </ul>

      <!-- No answer reveal and no tutor here: the answer is one of four things on screen,
           and a nudge towards it would just be the answer. So this holds the hint alone. -->
      <div class="help" v-if="exercise.hint">
        <button class="btn ghost" @click="showHint = !showHint">
          <Icon name="hint" />{{ showHint ? 'Hide hint' : 'Take a hint' }}
        </button>
        <div v-if="showHint" class="prose hintbody" v-html="mdx(exercise.hint)"></div>
      </div>

      <!-- Said in words as well as drawn, because the bars say how the answers SPLIT and a
           tutor's first question is how many have come in at all. Nine of twelve with the
           class evenly split is a different moment from three of twelve. -->
      <p v-if="classAnswers" class="answered">
        {{ classAnswers.answered }} answered<template v-if="!classAnswers.answered">
          — nobody has submitted yet</template>
      </p>

      <div class="foot">
        <p v-if="submitted" class="feedback" :class="{ pass: correct(), fail: !correct() }"
           v-html="mdx(exercise.feedback?.[picked] || (correct() ? 'Correct.' : 'Not quite.'))"></p>
        <button v-if="!submitted" class="btn primary" :disabled="picked === null" @click="submit">
          Submit answer
        </button>
        <button v-else-if="!correct()" class="btn ghost" @click="submitted = false; picked = null">
          Try again
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcq { overflow: auto; padding: 40px; display: flex; justify-content: center; }
.card { width: min(760px, 100%); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
h2 { margin: 0 0 8px; font-size: 22px; }
.xp { color: var(--ice-primary-strong); font-size: 12px; font-weight: 600; white-space: nowrap; }
.options { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 10px; }
.option { position: relative; overflow: hidden;
          display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left;
          padding: 14px 16px; border-radius: var(--ice-radius); cursor: pointer;
          background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
          color: var(--ice-fg); font: inherit; transition: border-color .12s, background .12s; }
/* The class's share of this option, behind everything. `inset` rather than a height, so it
   fills whatever the option grew to - these are markdown and two of them are often three
   lines and one. Animated because answers land one at a time and a bar that jumped would be
   the only thing on the screen that moved without being touched. */
.share { position: absolute; inset: 0 auto 0 0; z-index: 0; pointer-events: none;
         background: var(--ice-primary-soft); transition: width .35s ease; }
/* Stronger than the option's own tint, which the `right`/`wrong` classes have already put
   underneath it - otherwise the bar disappears into exactly the option it is measuring.
   The line colours at low opacity rather than a fifth pair of tokens. */
.share.right { background: var(--ice-good-line); opacity: .24; }
.share.wrong { background: var(--ice-bad-line); opacity: .2; }
.option > .marker, .option > .prose, .option > .count { position: relative; z-index: 1; }
.count { margin-left: auto; flex: none; align-self: center; min-width: 22px; text-align: right;
         font-family: var(--ice-font-mono); font-size: 12px; font-weight: 600;
         font-variant-numeric: tabular-nums; color: var(--ice-primary-strong); }
.count.none { color: var(--ice-fg-muted); font-weight: 400; }
.answered { margin: 12px 0 0; font-size: 12px; color: var(--ice-fg-muted); }
.option:hover:not(:disabled) { border-color: var(--ice-primary-soft); }
.option.picked { border-color: var(--ice-primary); }
.option.right { border-color: var(--ice-good-line); background: var(--ice-good-fill); }
.option.wrong { border-color: var(--ice-bad-line); background: var(--ice-bad-fill); }
.option:disabled { cursor: default; }
.marker { flex: none; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
          font-size: 12px; font-weight: 600; background: var(--ice-bg); border: 1px solid var(--ice-border); }
.help { margin-top: 22px; }
.hintbody { margin-top: 8px; padding: 10px 12px; background: var(--ice-bg-soft);
            border-radius: var(--ice-radius); }
.foot { margin-top: 24px; display: flex; align-items: center; gap: 16px; }
.feedback { margin: 0; margin-right: auto; font-size: 14px; }
.feedback.pass { color: var(--ice-good); }
.feedback.fail { color: var(--ice-bad); }
</style>
