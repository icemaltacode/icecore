<script setup>
/* Somebody's screen is being driven, and you are one of the two people it is happening to.
 *
 * SAME SHAPE AND COLOUR AS LiveBand AND WatchBanner, and for the same reason: all three say
 * which mode you are in, and a third look for that idea would be a third vocabulary. What is
 * different here is the weight - this band is a claim on somebody else's browser, so it is
 * the one that carries an accent line and a control on both sides rather than only on one.
 *
 * BOTH SIDES CAN END IT, and the student's half is the point. A screen someone else can
 * drive without the person being able to stop them is not something to ship, so the student's
 * button is a primary one and says Stop rather than hiding behind a menu. The server agrees:
 * `release` is conditional on being either end of the pair, not on being an admin.
 *
 * The class is a THIRD audience and does not see this band. They get LiveBand's ordinary
 * following sentence with a different name in it, because from where they sit nothing has
 * changed except whose screen they are watching.
 */
import Icon from './Icon.vue';

const props = defineProps({
  /** 'driving' when this is the admin's control tab, 'driven' when it is the student's. */
  side: String,
  /** The student being driven. */
  name: String,
  /** The admin doing the driving. */
  byName: String,
  /** Whether the class is seeing it too. Only the driver may change it. */
  sharing: Boolean,
});
const emit = defineEmits(['stop', 'sharing']);
</script>

<template>
  <div class="control" :class="side" role="status">
    <span class="dot" aria-hidden="true"></span>

    <!-- IT SAYS THAT WORK IS RECORDED AGAINST THEM, and that is the sentence that matters
         most on this band. An exercise solved while an educator is driving is the student's
         progress and the student's XP - it has to be, or being helped would cost them the
         exercise - and an educator who did not know that would be surprised by it later. -->
    <span class="what" v-if="side === 'driving'">
      You are controlling <strong>{{ name || 'a student' }}</strong>'s screen.
      <span class="sub">Anything solved here is recorded as theirs, marked as done by you.
        They can stop it at any time.</span>
    </span>
    <span class="what" v-else>
      <strong>{{ byName || 'Your educator' }}</strong> is controlling your screen.
      <span class="sub">Your editor is theirs while this lasts, and anything solved counts as
        yours.<template v-if="sharing"> The class is watching this screen.</template></span>
    </span>

    <!-- The switch lives here as well as in the prompt, because the moment to stop showing
         somebody's screen arrives DURING the session rather than before it. Same field, so
         the two can never disagree about whether the class is watching. -->
    <label v-if="side === 'driving'" class="share">
      <input type="checkbox" :checked="sharing"
             @change="emit('sharing', $event.target.checked)">
      <Icon name="people" :size="14" />
      Show the class
    </label>

    <button class="btn" :class="side === 'driven' ? 'primary' : 'danger'" type="button"
            @click="emit('stop')">
      {{ side === 'driven' ? 'Stop' : 'Stop controlling' }}
    </button>
  </div>
</template>

<style scoped>
/* `control` is unique across the app - Vue's scoped CSS reaches a child component's root,
   and `band` is LiveBand's. Same failure LivePanel.vue documents at length. */
.control { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
           background: var(--ice-primary-soft); color: var(--ice-fg);
           border-bottom: 1px solid var(--ice-primary); font-size: 13px; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ice-primary); }

/* THE STUDENT'S SIDE WEARS THE CARET'S COLOUR, and it is the same token - `--ice-drive`,
   defined once in styles.css. The bar at the top of their screen and the caret moving in
   their editor are the same event seen twice, and in the product's own primary they read as
   two unrelated pieces of chrome. It is the educator's side that stays primary: nothing is
   happening TO them.

   Not the danger colour, for WatchBanner's reason - being helped is not a failure, and a red
   bar reads as an alarm that cannot be dismissed. */
.control.driven { background: var(--ice-drive-fill); border-bottom-color: var(--ice-drive-line);
                  box-shadow: inset 0 3px 0 var(--ice-drive-line); }
.control.driven .dot { background: var(--ice-drive-line); }
.control.driven .btn.primary { background: var(--ice-drive); border-color: var(--ice-drive);
                               color: var(--ice-on-drive); }
@media (prefers-reduced-motion: no-preference) {
  .dot { animation: pulse 2.4s ease-in-out infinite; }
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.what { flex: 1; min-width: 0; }
.what strong { font-weight: 600; }
.sub { color: var(--ice-fg-muted); }
@media (max-width: 720px) { .sub { display: none; } }

.share { display: inline-flex; align-items: center; gap: 6px; flex: none; cursor: pointer;
         padding: 4px 10px 4px 8px; border-radius: 999px; font-size: 12px;
         background: var(--ice-bg); border: 1px solid var(--ice-border); }
.share input { margin: 0; accent-color: var(--ice-primary); }
</style>
