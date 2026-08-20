<script setup>
import { ref, watch } from 'vue';
import { md } from '../md.js';
import { imageBase, appBase } from '../content.js';

const props = defineProps({ courseId: String, exercise: Object, done: Boolean });
const emit = defineEmits(['solved']);

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

function submit() {
  if (picked.value === null) return;
  submitted.value = true;
  if (correct()) emit('solved', props.exercise.id);
}
</script>

<template>
  <div class="mcq">
    <div class="card">
      <header>
        <h2>{{ exercise.title }}</h2>
        <span class="xp">{{ exercise.xp }} XP</span>
      </header>

      <div class="prose" v-html="mdx(exercise.prompt)"></div>

      <ul class="options">
        <li v-for="(opt, i) in exercise.options" :key="i">
          <button
            class="option"
            :class="{
              picked: picked === i,
              right: submitted && i === exercise.answer,
              wrong: submitted && picked === i && i !== exercise.answer,
            }"
            :disabled="submitted"
            @click="picked = i">
            <span class="marker">{{ String.fromCharCode(65 + i) }}</span>
            <span class="prose inline" v-html="mdx(opt)"></span>
          </button>
        </li>
      </ul>

      <!-- No answer reveal and no tutor here: the answer is one of four things on screen,
           and a nudge towards it would just be the answer. So this holds the hint alone. -->
      <div class="help" v-if="exercise.hint">
        <button class="link" @click="showHint = !showHint">
          {{ showHint ? 'Hide hint' : 'Take a hint' }}
        </button>
        <div v-if="showHint" class="prose hintbody" v-html="mdx(exercise.hint)"></div>
      </div>

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
.option { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left;
          padding: 14px 16px; border-radius: var(--ice-radius); cursor: pointer;
          background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
          color: var(--ice-fg); font: inherit; transition: border-color .12s, background .12s; }
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
