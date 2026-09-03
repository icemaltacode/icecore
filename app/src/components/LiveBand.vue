<script setup>
/* You are in a live session. Standing, for as long as it lasts.
 *
 * DELIBERATELY THE SAME SHAPE AND COLOUR AS WatchBanner, because it says the same KIND of
 * thing: which mode you are in. Everything below either band is the ordinary player - the
 * same sidebar, the same exercises - so the band is the only thing distinguishing this
 * screen from any other, and two different-looking bands for that job would leave a student
 * learning two vocabularies for one idea.
 *
 * IT SAYS SOMETHING DIFFERENT TO EACH SIDE, from one component. The tutor is told what they
 * are doing and given the way to stop; the student is told whose session they are in and
 * given the way out. One file because the two sentences have to stay parallel: written
 * separately they drift, and the pair of them is what makes the feature legible from both
 * ends.
 *
 * The elapsed time is counted from the session's own `at` rather than from when this tab
 * joined, so a student who arrives late sees how long the lesson has been running rather
 * than how long they have been in it.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { live as channel } from '../live.js';

const props = defineProps({
  /** The session: cohort, course, by, name, at. */
  session: Object,
  /** Whether we are the one delivering. */
  mine: Boolean,
  cohortTitle: String,
  courseTitle: String,
  /** How many are connected. */
  here: { type: Number, default: null },
  /** Whether this screen still moves with the tutor's. Meaningless when `mine`. */
  following: { type: Boolean, default: true },
  /** What the tutor is on, so leaving says what you would be going back to. */
  leaderAt: String,
  /** Whether the room has said where the tutor is yet. */
  canCatchUp: Boolean,
  /* Whose screen the room is on, when it is not the educator's. Set for a CLASSMATE while a
   * student's screen is shared - the two people it is actually happening to get ControlBand
   * instead. From where a classmate sits nothing has changed except the name, which is why
   * this is a word in the existing sentence rather than a band of its own. */
  sharedName: String,
});
const emit = defineEmits(['end', 'leave', 'catch-up']);

const now = ref(Date.now());
let tick;
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => clearInterval(tick));

/* mm:ss under an hour and h:mm:ss over it, so a forty-minute lesson is not reported as
 * 0:40:12 - the leading zero makes the number look like a countdown. */
const elapsed = computed(() => {
  const from = props.session?.at ? Date.parse(props.session.at) : now.value;
  const s = Math.max(0, Math.floor((now.value - from) / 1000));
  const two = n => String(n).padStart(2, '0');
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
    : `${Math.floor(s / 60)}:${two(s % 60)}`;
});

/* A socket that is reconnecting is ORDINARY - a train, a lid, API Gateway's two-hour cap -
 * so it is reported as a quiet aside rather than as an error. A student shown something red
 * every time their connection blinks learns to ignore the band that matters. */
const reconnecting = computed(() => channel.status === 'waiting' || channel.status === 'opening');
</script>

<template>
  <div class="band" role="status">
    <span class="dot" aria-hidden="true"></span>

    <span class="what">
      <template v-if="mine">
        Delivering live to <strong>{{ cohortTitle }}</strong><template v-if="courseTitle"> —
        {{ courseTitle }}</template>.
        <span class="sub" v-if="sharedName">The class is watching {{ sharedName }}'s
          screen.</span>
        <span class="sub" v-else-if="here !== null">{{ here }} here.</span>
      </template>
      <!-- A classmate, while somebody's screen is being shared. Said as plainly as it can be:
           the screen is not the educator's, it is not yours, and nothing you do reaches it. -->
      <template v-else-if="following && sharedName">
        Watching <strong>{{ sharedName }}</strong>'s screen, live.
        <span class="sub">{{ session?.name || 'Your educator' }} is helping them. Move on your
          own whenever you like — nothing is lost.</span>
      </template>
      <template v-else-if="following">
        Following <strong>{{ session?.name || 'your educator' }}</strong>, live.
        <span class="sub">Your screen moves with theirs. Move on your own whenever you
          like — nothing is lost.</span>
      </template>
      <!-- Not a warning and not an error. They did a perfectly ordinary thing, and the band
           says what changed and offers the way back rather than telling them off. -->
      <template v-else>
        You have stopped following <strong>{{ session?.name || 'your educator' }}</strong> and
        are working on your own.
        <span class="sub"><template v-if="leaderAt">They are on {{ leaderAt }}. </template>Your
          work here is kept either way.</span>
      </template>
      <span v-if="reconnecting" class="sub away">Reconnecting…</span>
    </span>

    <span class="clock">{{ elapsed }}</span>

    <button v-if="mine" class="btn danger" type="button" @click="emit('end')">End session</button>
    <template v-else>
      <!-- The one nudge gesture, as `.btn.urge` already defines it in styles.css: there is
           a thing to do here, and it loops until it is answered. Only offered once the room
           has said where the tutor actually is - a Catch up that cannot go anywhere is a
           button that does nothing. -->
      <button v-if="!following && canCatchUp" class="btn primary urge" type="button"
              @click="emit('catch-up')">Catch up</button>
      <button class="btn" type="button" @click="emit('leave')">Leave</button>
    </template>
  </div>
</template>

<style scoped>
/* Not the danger colour, for WatchBanner's reason: nothing is wrong and nothing is at risk.
   This is a statement of where you are. */
.band { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
        background: var(--ice-primary-soft); color: var(--ice-fg);
        border-bottom: 1px solid var(--ice-primary-soft); font-size: 13px; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ice-primary); }
/* It pulses, because a band that never changes stops being read after ten minutes and this
   one has to survive being looked past. Slow enough not to nag. */
@media (prefers-reduced-motion: no-preference) {
  .dot { animation: pulse 2.4s ease-in-out infinite; }
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.what { flex: 1; min-width: 0; }
.what strong { font-weight: 600; }
.sub { color: var(--ice-fg-muted); }
.sub.away { margin-left: 6px; font-style: italic; }
.clock { font-family: var(--ice-font-mono); font-variant-numeric: tabular-nums;
         font-size: 12px; color: var(--ice-fg-muted); }
@media (max-width: 720px) { .sub { display: none; } }
</style>
