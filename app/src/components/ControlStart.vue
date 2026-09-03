<script setup>
/* Before taking control of somebody's screen. Mock screen 13.
 *
 * IT ASKS ONE QUESTION AND THE BOX IS UNTICKED. Helping a student who is stuck is the
 * ordinary case; putting their screen in front of eleven classmates is not, and a default of
 * on makes the quiet version the thing you have to remember to ask for. That is the wrong way
 * round for something the student cannot undo from their side.
 *
 * IT IS A PROMPT RATHER THAN A TOGGLE IN THE PANEL because the decision and the act belong
 * together: a switch set once and then forgotten is how somebody's screen ends up shared in
 * a lesson three weeks later. The same switch does live in the control band afterwards - the
 * moment to STOP showing a screen arrives during the session - but it is never the thing that
 * starts it.
 *
 * What it does NOT say is that the class will see the student's other tabs or their desktop,
 * because they will not: what crosses the channel is a position, never pixels. Saying so
 * would introduce a worry the architecture has already answered.
 */
import { ref } from 'vue';

defineProps({
  /** Who is about to be controlled. */
  name: String,
  /** How many other people are in the room, so "the class" is a number. */
  others: { type: Number, default: 0 },
});
const emit = defineEmits(['take', 'close']);

const sharing = ref(false);
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ctl-h">
      <h3 id="ctl-h">Control {{ name || 'this student' }}'s screen</h3>

      <p class="lead">You will be able to move them around the course, and see what they
        see. They are told it is happening and can stop it at any time.</p>

      <label class="choice" :class="{ on: sharing }">
        <input v-model="sharing" type="checkbox">
        <span>
          <strong>Show {{ name || 'their' }}'s screen to the class</strong>
          <em v-if="sharing">Everyone else in the session will follow this screen instead of
            yours, read-only, until you turn this off.</em>
          <em v-else>Off — the rest of the class stays where you left them.</em>
        </span>
      </label>

      <div class="acts">
        <button class="btn ghost" type="button" @click="emit('close')">Cancel</button>
        <button class="btn primary" type="button" @click="emit('take', sharing)">
          Take control
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
         background: rgb(0 0 0 / .45); padding: 20px; }
.sheet { width: min(460px, 100%); background: var(--ice-bg); border-radius: 14px;
         border: 1px solid var(--ice-border); padding: 22px;
         box-shadow: 0 20px 60px rgb(0 0 0 / .3); }
h3 { margin: 0 0 10px; font-size: 17px; }
.lead { margin: 0 0 18px; font-size: 13px; line-height: 1.55; color: var(--ice-fg-muted); }

.choice { display: flex; gap: 10px; align-items: flex-start; padding: 12px;
          border: 1px solid var(--ice-border); border-radius: 10px; cursor: pointer;
          font-size: 13px; line-height: 1.5; }
.choice.on { border-color: var(--ice-primary); background: var(--ice-primary-soft); }
.choice input { margin: 2px 0 0; accent-color: var(--ice-primary); }
.choice strong { display: block; font-weight: 600; }
/* The consequence, restated as it changes. A tickbox whose caption never moves is one people
   read once; this one is the whole decision. */
.choice em { display: block; margin-top: 3px; font-style: normal; font-size: 12px;
             color: var(--ice-fg-muted); }

.acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
