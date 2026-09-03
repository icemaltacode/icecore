<script setup>
/* Your class has started. Mock screen 7.
 *
 * PERSISTENT AND UNDISMISSABLE, and those are two different claims. It cannot be closed
 * because a lesson that has started stays started, and a student who dismissed it at 9:01
 * and looked up at 9:20 would have no way back to it. It does not INTERRUPT for the opposite
 * reason: a modal would stop somebody mid-exercise to tell them about something they are
 * allowed to ignore, and being late to a lesson is not an emergency.
 *
 * So it is a band, drawn over whatever they were doing - deliberately including a different
 * course, which is the case the rule exists for. They can carry on, and it will still be
 * there.
 *
 * IT NAMES THE COURSE, not just the class. "Keith is delivering live" is an invitation to a
 * room; a student wants to know whether it is the thing they are already working on, and
 * `course` is the field that answers it.
 */
import Icon from './Icon.vue';

defineProps({
  /** The session: cohort, title, course, name, at. */
  session: Object,
  /** The course's own title, when the grid has it - the session carries only its id. */
  courseTitle: String,
});
defineEmits(['join']);
</script>

<template>
  <div class="invite" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="what">
      <strong>{{ session?.name || 'Your educator' }}</strong> is delivering
      <strong v-if="courseTitle">{{ courseTitle }}</strong><template v-else>a lesson</template>
      to {{ session?.title || 'your class' }}, live.
      <span class="sub">Carry on with what you are doing if you like — this will stay
        here.</span>
    </span>
    <button class="btn primary urge" type="button" @click="$emit('join')">
      <Icon name="live" :size="14" />Join
    </button>
  </div>
</template>

<style scoped>
/* `invite` is unique across the app - Vue's scoped CSS reaches a child component's root, and
   `band` is LiveBand's. Same failure LivePanel.vue documents at length.

   The same shape and colour as the other three bands, because it is the same kind of
   statement. What is different is that this one has something to DO rather than something to
   know, which is why the button carries `.btn.urge` - the one nudge gesture styles.css
   already defines, looping until it is answered. */
.invite { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
          background: var(--ice-primary-soft); color: var(--ice-fg);
          border-bottom: 1px solid var(--ice-primary-soft); font-size: 13px; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ice-primary); }
@media (prefers-reduced-motion: no-preference) {
  .dot { animation: pulse 2.4s ease-in-out infinite; }
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.what { flex: 1; min-width: 0; }
.what strong { font-weight: 600; }
.sub { color: var(--ice-fg-muted); }
@media (max-width: 720px) { .sub { display: none; } }
</style>
