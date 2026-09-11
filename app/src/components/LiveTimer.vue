<script setup>
/* THE COUNTDOWN, on every screen in the room - and, for the educator, the controls that set
 * it going.
 *
 * ONE COMPONENT FOR BOTH SIZES AND BOTH SIDES, which is LiveBand's reason: they are one fact
 * seen from three places, and drawn by three components they would drift. What differs is
 * small enough to say in the template - a student gets the reading and nothing else, and
 * `prominent` changes where the reading is drawn rather than what it says.
 *
 * IT LIVES IN THE BAND rather than at the top right of the editor, which is where the brief
 * put it. The band is the one element that is on screen for the whole of a lesson: a timer
 * anchored to the editor is missing from a slides topic, from a multiple-choice question and
 * from a whiteboard, and "you have five minutes to read this" is a thing an educator says
 * about all four. It also cannot collide with the participants panel, the chat window or a
 * toast, all of which own the corners.
 *
 * THE LARGE ONE IS A FIXED PANEL AND TAKES NO CLICKS. It floats over the bottom of the
 * player, so `pointer-events: none` is the difference between a prominent timer and a
 * prominent timer sitting on top of the Check button. It is drawn from here rather than from
 * App.vue so that there is one reader of the timer's state - a fixed element escapes the
 * band's flex row and lands where it likes regardless of where it is written.
 *
 * NOTHING HERE ANNOUNCES ITSELF. The band is a `role="status"` with `aria-live="polite"`, and
 * a live region holding a clock that changes four times a second is a screen reader saying a
 * number over the top of the lesson forever. `aria-live="off"` on the way down stops it, and
 * `role="timer"` is what this actually is.
 */
import { ref, computed, watch, onUnmounted } from 'vue';
import { timer, label, done, urgent, DURATIONS,
         setTimer, pauseTimer, resumeTimer, showTimer, clearTimer } from '../timer.js';
import Icon from './Icon.vue';

defineProps({
  /** Whether we are the one delivering. Only the educator gets the controls. */
  mine: Boolean,
});

const root = ref(null);
const open = ref(false);
/* What the tick would mean if a timer were set right now. It is only this client's
 * intention until there is a timer for it to be a fact about, at which point the timer's own
 * flag is the answer - the same reason the switches in the band read their state back. */
const wanted = ref(false);
const prominent = computed({
  get: () => (timer.on ? timer.prominent : wanted.value),
  set: v => { wanted.value = !!v; if (timer.on) showTimer(!!v); },
});

const minutes = computed(() => Math.round(timer.seconds / 60));

/* Closed by a click anywhere else. Its own listener rather than a shared one - the pair in
 * TopBar share one because each would otherwise close on the gesture that opened the other,
 * and this popover is nowhere near either. Attached a beat late so that the click which
 * opened it is not the click that closes it. */
const away = e => { if (!root.value?.contains(e.target)) open.value = false; };
let arming = null;
watch(open, v => {
  clearTimeout(arming);
  if (v) arming = setTimeout(() => document.addEventListener('pointerdown', away), 0);
  else document.removeEventListener('pointerdown', away);
});
onUnmounted(() => { clearTimeout(arming); document.removeEventListener('pointerdown', away); });

const pick = m => { open.value = false; setTimer(m * 60, prominent.value); };
</script>

<template>
  <div class="livetimer" ref="root" role="timer" aria-live="off">
    <!-- The reading itself, and everybody gets the same one. -->
    <span v-if="timer.on" class="ltchip" :class="{ urgent, done, held: !timer.running }">
      <Icon name="clock" :size="13" />
      <span class="ltnum">{{ label }}</span>
      <!-- Paused is a state somebody chose, so it is said rather than implied by a clock
           that has stopped - a stopped clock is also what a broken one looks like. -->
      <em v-if="!timer.running && !done">paused</em>
    </span>

    <template v-if="mine">
      <!-- Pause and Reset only once there is something to pause and reset. A row of dead
           controls beside a timer that has not been set is three things to read and none to
           press. -->
      <template v-if="timer.on">
        <button class="ltbtn" type="button"
                :title="timer.running ? 'Pause the countdown' : 'Carry on from where it stopped'"
                @click="timer.running ? pauseTimer() : resumeTimer()">
          <Icon :name="timer.running ? 'pause' : 'run'" :size="13" />
        </button>
        <button class="ltbtn" type="button"
                :title="`Start the ${minutes} minutes again`"
                @click="setTimer(timer.seconds)">
          <Icon name="undo" :size="13" />
        </button>
      </template>
      <button class="ltbtn more" type="button" :class="{ on: open }"
              :title="timer.on ? 'Another length, or how it is shown' : 'Give the class a countdown'"
              @click="open = !open">
        <Icon v-if="!timer.on" name="clock" :size="13" />
        <span v-if="!timer.on" class="ltword">Timer</span>
        <Icon v-else name="chevron" :size="13" />
      </button>
      <button v-if="timer.on" class="ltbtn" type="button" title="Take the timer away"
              @click="clearTimer()">
        <Icon name="close" :size="13" />
      </button>

      <div v-if="open" class="ltpop">
        <p class="ltlead">{{ timer.on ? 'Start again with' : 'The class gets' }}</p>
        <div class="ltmins">
          <button v-for="m in DURATIONS" :key="m" type="button" class="ltmin"
                  :class="{ on: timer.on && minutes === m }" @click="pick(m)">
            {{ m }}<small>min</small>
          </button>
        </div>
        <!-- A property of the timer, not of each screen: it is the educator deciding how
             loudly the room is being asked to look at the clock. -->
        <label class="ltprom">
          <input type="checkbox" v-model="prominent">
          Show it large, at the bottom of every screen
        </label>
      </div>
    </template>
  </div>

  <!-- Fixed, over the player, and deliberately unclickable. Everyone sees it, the educator
       included: what the room has been given is a thing they are running the lesson by. -->
  <div v-if="timer.on && timer.prominent" class="ltbig" :class="{ urgent, done }"
       role="timer" aria-live="off">
    <strong>{{ label }}</strong>
    <span v-if="done">Time’s up</span>
    <span v-else-if="!timer.running">Paused</span>
    <span v-else>left</span>
  </div>
</template>

<style scoped>
/* Unique root class, like every other component here - Vue's scoped CSS reaches a child's
   root element, and `timer` is a name something else will want. */
.livetimer { display: flex; align-items: center; gap: 4px; flex: none; position: relative; }

.ltchip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px;
          border-radius: 999px; background: var(--ice-bg); border: 1px solid var(--ice-border);
          color: var(--ice-fg); }
.ltnum { font-family: var(--ice-font-mono); font-variant-numeric: tabular-nums;
         font-size: 12.5px; font-weight: 600; }
.ltchip em { font-style: normal; font-size: 9.5px; letter-spacing: .06em;
             text-transform: uppercase; color: var(--ice-fg-muted); }
/* The last minute, and then the end of it. Two steps rather than a gradient: a colour that
   creeps is one nobody notices changing, and these are the only two moments worth a look up
   from the exercise. */
.ltchip.urgent { background: var(--ice-warn-fill); border-color: var(--ice-warn-line);
                 color: var(--ice-warn); }
.ltchip.done { background: var(--ice-bad-fill); border-color: var(--ice-bad-line);
               color: var(--ice-bad); }
/* Paused wears no colour at all: nothing is running out, so nothing is urgent. */
.ltchip.held { background: var(--ice-bg-soft); color: var(--ice-fg-muted); }
.ltchip.held :deep(.icon) { opacity: .7; }

.ltbtn { display: inline-flex; align-items: center; gap: 5px; padding: 3px 6px; cursor: pointer;
         background: none; border: 1px solid transparent; border-radius: 7px; line-height: 0;
         color: var(--ice-fg-muted); font: inherit; font-size: 12px; }
.ltbtn:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }
.ltbtn.on { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }
.ltword { line-height: 1; }

.ltpop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 50; width: max-content;
         max-width: min(300px, calc(100vw - 32px)); padding: 12px;
         background: var(--ice-bg); border: 1px solid var(--ice-border); border-radius: 10px;
         box-shadow: 0 12px 32px rgb(0 0 0 / .22); text-align: left; }
.ltlead { margin: 0 0 8px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
          color: var(--ice-fg-muted); }
.ltmins { display: flex; flex-wrap: wrap; gap: 6px; }
.ltmin { display: inline-flex; align-items: baseline; gap: 3px; padding: 5px 9px; cursor: pointer;
         background: var(--ice-bg-soft); border: 1px solid var(--ice-border); border-radius: 8px;
         color: var(--ice-fg); font: inherit; font-size: 13px; font-weight: 600; }
.ltmin small { font-size: 9.5px; font-weight: 400; color: var(--ice-fg-muted); }
.ltmin:hover { border-color: var(--ice-primary); }
.ltmin.on { background: var(--ice-primary-soft); border-color: var(--ice-primary); }
.ltprom { display: flex; align-items: flex-start; gap: 7px; margin-top: 10px; cursor: pointer;
          font-size: 12px; line-height: 1.35; color: var(--ice-fg-muted); }
.ltprom input { margin: 1px 0 0; }

/* Over the player and under every dialog, which is the whole of where it belongs in the
   stack: above the whiteboard, because a deadline given during a demonstration is still the
   deadline, and below anything somebody is being asked to answer. */
.ltbig { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 55;
         pointer-events: none; display: flex; align-items: baseline; gap: 10px;
         padding: 10px 22px; border-radius: 14px;
         background: var(--ice-bg); border: 1px solid var(--ice-border);
         box-shadow: 0 14px 40px rgb(0 0 0 / .26); color: var(--ice-fg); }
.ltbig strong { font-family: var(--ice-font-mono); font-variant-numeric: tabular-nums;
                font-size: 40px; font-weight: 700; line-height: 1; letter-spacing: -.01em; }
.ltbig span { font-size: 13px; color: var(--ice-fg-muted); }
.ltbig.urgent { background: var(--ice-warn-fill); border-color: var(--ice-warn-line);
                color: var(--ice-warn); }
.ltbig.urgent span { color: var(--ice-warn); }
.ltbig.done { background: var(--ice-bad-fill); border-color: var(--ice-bad-line);
              color: var(--ice-bad); }
.ltbig.done span { color: var(--ice-bad); }
/* It arrives once and then holds. A panel that pulsed for ten minutes would be read for the
   first thirty seconds and resented for the rest. */
@media (prefers-reduced-motion: no-preference) {
  .ltbig { animation: ltrise .18s ease-out; }
}
@keyframes ltrise { from { opacity: 0; transform: translate(-50%, 10px); } }

/* On a phone the band is already tight: the reading survives and the word does not. */
@media (max-width: 720px) {
  .ltword { display: none; }
  .ltbig strong { font-size: 30px; }
}
</style>
