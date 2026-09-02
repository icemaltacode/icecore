<script setup>
/* The warning shown before an answer is, once and never twice for the same exercise.
 *
 * ITS OWN COMPONENT BECAUSE THREE EXERCISE TYPES ASK THE SAME QUESTION. SQL, Python and
 * drag-and-drop all offer Show answer, and a warning worded three slightly different ways is
 * how a platform ends up meaning three slightly different things by it.
 *
 * INLINE, NOT A MODAL. It is a consequence to read, not a decision to be interrupted for -
 * and a student who came here to give up on an exercise is already frustrated. It appears
 * where the answer would appear, so the thing it is warning about is the thing it replaces.
 */
defineProps({
  /** What the exercise is worth, so the notice names the cost rather than implying one. */
  xp: Number,
});
const emit = defineEmits(['confirm', 'cancel']);

import { ref } from 'vue';
const quiet = ref(false);
</script>

<template>
  <div class="notice">
    <p class="what">
      <strong>Showing the answer means no XP for this exercise.</strong>
      <!-- Names the number. "You will lose XP" is a warning; "this is worth 100 XP" is the
           fact the student is actually weighing. -->
      <template v-if="xp"> This one is worth {{ xp.toLocaleString() }} XP.</template>
      You can still finish it, and it will still count as complete.
    </p>

    <label class="quiet">
      <input type="checkbox" v-model="quiet">
      <span>Don't warn me again</span>
    </label>

    <div class="acts">
      <button class="btn" @click="emit('confirm', quiet)">Show the answer</button>
      <button class="btn ghost" @click="emit('cancel')">Keep trying</button>
    </div>
  </div>
</template>

<style scoped>
/* The colour of a consequence rather than of an error: nothing has gone wrong, and a red
   panel here would read as the student having broken something. */
.notice { margin-top: 10px; padding: 12px 14px; border-radius: var(--ice-radius);
          border: 1px solid var(--ice-border); background: var(--ice-raise); }
.what { margin: 0; font-size: 13px; line-height: 1.6; }
.what strong { color: var(--ice-fg); }

.quiet { display: flex; align-items: center; gap: 8px; margin-top: 10px;
         font-size: 12px; color: var(--ice-fg-muted); cursor: pointer; }
.quiet input { accent-color: var(--ice-primary); }

.acts { display: flex; gap: 8px; margin-top: 12px; }
/* "Keep trying" is the quiet one on purpose. The default here should feel like carrying on,
   not like the button that ends the exercise. */
</style>
