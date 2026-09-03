<script setup>
/* Are you sure you want to leave the lesson?
 *
 * A CONFIRMATION FOR SOMETHING THAT IS NOT DESTRUCTIVE, which is unusual here and is the
 * point: leaving costs nothing and looks like it costs everything. A student who presses it
 * by accident is out of a lesson the rest of the class is still in, with no idea whether they
 * can get back or what happened to the work they had done - and the answer to both is
 * reassuring, so it is worth a sentence before the fact rather than a discovery after it.
 *
 * SO THE COPY IS THE FEATURE. "Are you sure?" over two buttons answers nothing; what somebody
 * needs to know is that the class carries on, their work is kept, and the way back is the
 * same banner that got them here.
 *
 * Staying is the default action and reads first, because pressing Leave and then reading the
 * dialog is the exact sequence this exists to interrupt.
 */
import { computed } from 'vue';

const props = defineProps({
  /** Whose lesson, so the question names the thing being left. */
  name: String,
  cohortTitle: String,
});
defineEmits(['leave', 'close']);

/* BUILT AS A STRING, not assembled out of `<template v-if>` in the middle of a sentence.
 * Vue condenses whitespace, and a leading space inside a conditional template is exactly the
 * kind it eats - which is how this shipped reading "carries on teachingPython - ONEY 2026".
 * A sentence with a hole in it is a string with a hole in it. */
const lead = computed(() =>
  `${props.name || 'Your educator'} carries on teaching`
  + (props.cohortTitle ? ` ${props.cohortTitle}` : '')
  + ', and your screen stops following theirs.');
</script>

<template>
  <div class="scrim" @click.self="$emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="leave-h">
      <h3 id="leave-h">Leave this lesson?</h3>
      <p class="lead">{{ lead }}</p>
      <ul class="facts">
        <li>Everything you have done is kept.</li>
        <li>You can rejoin from the banner while the lesson is still running.</li>
      </ul>
      <div class="acts">
        <button class="btn primary" type="button" @click="$emit('close')">Stay</button>
        <button class="btn" type="button" @click="$emit('leave')">Leave</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
         background: var(--ice-scrim); padding: 20px; }
.sheet { width: min(420px, 100%); background: var(--ice-bg); border-radius: 14px;
         border: 1px solid var(--ice-border); padding: 22px;
         box-shadow: 0 20px 60px rgb(0 0 0 / .3); }
h3 { margin: 0 0 10px; font-size: 17px; }
.lead { margin: 0 0 12px; font-size: 13.5px; line-height: 1.55; }
.facts { margin: 0; padding: 0 0 0 18px; font-size: 13px; line-height: 1.7;
         color: var(--ice-fg-muted); }
/* Leaving is not the danger colour and Stay is the primary one: nothing here is at risk, and
   the only thing worth nudging is the choice somebody probably meant. */
.acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
