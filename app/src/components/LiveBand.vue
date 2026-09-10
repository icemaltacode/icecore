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
import Icon from './Icon.vue';

const props = defineProps({
  /** The session: cohort, course, by, name, at. */
  session: Object,
  /** Whether we are the one delivering. */
  mine: Boolean,
  cohortTitle: String,
  courseTitle: String,
  /** Whether a whiteboard is up. Read back, never assumed - see the switch below. */
  boarding: Boolean,
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
  /* Whether the educator's editor is on the room's screens. ONE PROP FOR BOTH SIDES, because
   * it is one fact about the session: for the educator it is what their switch reads, and for
   * a student it is why their editor has gone read-only. Two props would be two chances for
   * the switch to say one thing and the class to be doing another. */
  syncing: Boolean,
});
const emit = defineEmits(['end', 'leave', 'catch-up', 'sync', 'board']);

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

/* THE BAND HAS TO TELL A DROPPED CONNECTION FROM A FINISHED LESSON, and until it did the two
 * looked identical from where a student sits: the room went quiet, and the only way to find
 * out which had happened was to reload the page. Ending a lesson takes this band away
 * entirely; losing the socket turns it yellow and says so.
 *
 * `channel.lost` rather than the status alone, because a first connection and a reconnection
 * are both 'opening' and only one of them is worth a colour - see live.js. Which also means
 * this cannot fire on the way IN to a lesson, where a yellow band would be the first thing a
 * student ever saw of the feature.
 *
 * It is still not an error, and the wording is the whole of that: nothing has gone wrong that
 * the student did or can fix, nothing they have done is lost, and the thing is already being
 * dealt with. Yellow says look; red would say act, and there is nothing to do. */
const away = computed(() => channel.lost && channel.status !== 'open');
</script>

<template>
  <div class="band" :class="{ away }" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true"></span>

    <!-- IT REPLACES THE SENTENCE RATHER THAN APPENDING TO IT. This was an aside on the end of
         the `.sub` line, which is grey, italic, and hidden outright under 720px - so on a
         laptop it was a whisper and on anything smaller it was not there at all. What a
         disconnected student needs is the first thing on the band, in the half of it that is
         never hidden. Where they are is said underneath, because that is the fact the yellow
         is otherwise ambiguous about: they have not been thrown out of the lesson. -->
    <span v-if="away" class="what">
      Connection lost — trying to reconnect…
      <span class="sub" v-if="mine">The class stops moving with you until this comes back.
        Nothing is lost.</span>
      <span class="sub" v-else>You are still in {{ session?.name || 'your educator' }}’s
        lesson. Nothing you have done is lost.</span>
    </span>

    <span v-else class="what">
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
        <!-- IT SAYS HOW TO GET OUT, because the editor below has just gone read-only and
             nothing else on the screen explains why. Moving is the way, which is the same
             gesture that ends following for every other reason - so this is a sentence about
             a rule the student already has rather than a second one to learn. And it
             promises the thing that makes moving safe: what they had written comes back. -->
        <!-- IT USED TO PROMISE THE WORK BACK, because sharing wrote into this student's own
             buffer and handed it over afterwards. It opens a tab of its own now, so the
             promise is not that their work returns - it is that it never went anywhere.
             Said as a fact about where things are rather than as a reassurance about a
             rescue, because there is no longer a rescue to describe. -->
        <span class="sub" v-if="syncing">They are writing in a tab of their own. Your work is
          untouched — switch back to it whenever you like.</span>
        <span class="sub" v-else>Your screen moves with theirs. Move on your own whenever you
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
    </span>

    <span class="clock">{{ elapsed }}</span>

    <!-- THE SWITCH SITS BESIDE End session, because those are the two things an educator
         does to the room rather than to one person - and the panel, where taking control of
         one student lives, is about people one at a time. It is a toggle rather than a
         press-and-hold: a demonstration lasts as long as the explanation does, and holding a
         button through it is not a thing anyone can do while also teaching. -->
    <button v-if="mine" class="btn ghost sync" :class="{ on: syncing }" type="button"
            :title="syncing
              ? 'Your editor is on the class\'s screens. Their own work comes back when you stop.'
              : 'Show the class what you type, in their own editors.'"
            @click="emit('sync', !syncing)">
      <Icon name="edit" :size="14" />
      {{ syncing ? 'Sharing editor' : 'Share editor' }}
    </button>
    <!-- BESIDE Share editor, because it is the same kind of thing: something an educator
         does to the ROOM rather than to one person. A board is not a place the class is sent
         to - it is an overlay, so nothing underneath it moves and nobody loses their row. -->
    <button v-if="mine" class="btn ghost sync" :class="{ on: boarding }" type="button"
            :title="boarding
              ? 'Put the whiteboard away. Everyone goes back to where they were.'
              : 'Draw for the class on a blank board.'"
            @click="emit('board', !boarding)">
      <Icon name="board" :size="14" />
      {{ boarding ? 'Whiteboard on' : 'Whiteboard' }}
    </button>
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
/* The whole band, not a word in it: at a glance from the back of a room the colour is the
   message and the sentence is the detail. The dot stops pulsing and holds - a pulse means
   the room is live, and the point of this state is that it is not. */
.band.away { background: var(--ice-warn-fill); border-bottom-color: var(--ice-warn-line);
             color: var(--ice-warn); }
.band.away .dot { background: var(--ice-warn-line); animation: none; }
.band.away .sub { color: var(--ice-warn); opacity: .85; }
/* On rather than pressed: it stays until it is switched back, so it wears the state
   colour rather than a click's. The caret's own colour, and deliberately - the accent moving
   in a student's editor and the switch that put it there are the same event seen from the two
   ends of the room, and in two different accents they read as two features. */
.sync { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.sync.on { background: var(--ice-drive-fill); border-color: var(--ice-drive-line);
           color: var(--ice-fg); }
.clock { font-family: var(--ice-font-mono); font-variant-numeric: tabular-nums;
         font-size: 12px; color: var(--ice-fg-muted); }
/* Except the one that says they are still in the lesson: that sentence is the difference
   between "reconnecting" and "you have been thrown out", and it is worth a second line on a
   small screen. */
@media (max-width: 720px) { .sub { display: none; } .band.away .sub { display: block; } }
</style>
