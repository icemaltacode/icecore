<script setup>
import Wordmark from './Wordmark.vue';
/* The bar across the top of every signed-in screen.
 *
 * It exists so the identity of the product and of the person using it sit in one fixed
 * place, rather than being repeated by whatever screen happens to be showing - the grid
 * and the sidebar each grew their own copy of the brand and their own sign-out before
 * this.
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { theme, resolved, CHOICES } from '../theme.js';

const props = defineProps({
  name: String,
  email: String,
  admin: Boolean,
  authed: Boolean,
  /** XP earned today, across every course. Zero is a real answer and is shown as one. */
  xpToday: Number,
});
defineEmits(['home', 'admin', 'signout']);

/* Falls back through name, then the local part of the email, then nothing.
 *
 * A backstop rather than the normal path: the pool declares `name` required, so the invite
 * Lambda always writes one - the local part itself when the admin typed no name. Defaulting
 * it to the whole address there instead is what makes this second fallback dead code and
 * puts a full email address in the corner of every page. Kept because a token predating that
 * fix, or any future writer that forgets, should degrade quietly rather than blankly. */
const label = computed(() => props.name || props.email?.split('@')[0] || '');
const initials = computed(() => {
  const words = label.value.split(/[\s._-]+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
});

/* Earning XP is the only thing in the player that happens TO the student rather than
 * because they clicked something, so it is the one number worth animating - a total that
 * silently reads 340 where it read 240 a moment ago is a number nobody watches.
 *
 * Two parts, both quiet. The number counts up, which says it is accumulating rather than
 * being replaced. A ring sweeps once around the pill, which registers in peripheral vision
 * without asking to be read - this sits in the corner of a screen whose middle is an
 * exercise, and the corner should not be competing with it.
 *
 * The sweep is driven from here rather than by a CSS animation because a conic gradient's
 * angle is not an animatable property without `@property`, and one frame loop is cheaper
 * than registering a custom property to get a second one.
 *
 * THE OPENING BALANCE IS NOT AN EARN. The first value this ever sees is the session's
 * total arriving from the API, and counting up to it would celebrate work done yesterday.
 * That one is taken silently; everything after it is something that just happened. */
const COUNT_MS = 650;
const SWEEP_MS = 700;
const shown = ref(props.xpToday || 0);
const sweeping = ref(false);
const ring = ref(null);
let opened = false, frame = 0, sweepFrame = 0;
/* Respected rather than assumed: a motion that says "you earned something" is exactly the
 * kind a student who has asked for less of it does not need. They still get the number. */
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function countTo(to) {
  cancelAnimationFrame(frame);
  const from = shown.value, started = performance.now();
  const step = now => {
    const p = Math.min(1, (now - started) / COUNT_MS);
    // Ease out: quick off the mark, settling onto the figure rather than stopping at it.
    shown.value = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/* One turn, at a constant rate - an eased sweep reads as the ring slowing down rather than
 * as a lap being completed. The angle is written straight onto the element instead of being
 * bound in the template, so sixty frames of it are sixty style writes rather than sixty
 * component re-renders. */
function sweep() {
  cancelAnimationFrame(sweepFrame);
  const started = performance.now();
  sweeping.value = true;
  const step = now => {
    const p = Math.min(1, (now - started) / SWEEP_MS);
    ring.value?.style.setProperty('--sweep', (p * 360).toFixed(1) + 'deg');
    if (p < 1) { sweepFrame = requestAnimationFrame(step); return; }
    sweeping.value = false;
    ring.value?.style.removeProperty('--sweep');
  };
  sweepFrame = requestAnimationFrame(step);
}

watch(() => props.xpToday, now => {
  const to = now || 0;
  if (!opened || still()) { opened = true; shown.value = to; return; }
  if (to > shown.value) sweep();
  countTo(to);
});
onBeforeUnmount(() => { cancelAnimationFrame(frame); cancelAnimationFrame(sweepFrame); });

/* The theme picker. The button shows what is in force, not what was chosen, so a student
 * on System can see which way it went without opening anything. */
const GLYPH = { light: '☀', dark: '☾' };
const menu = ref(false);
const wrap = ref(null);
const away = e => { if (!wrap.value?.contains(e.target)) menu.value = false; };
onMounted(() => addEventListener('pointerdown', away));
onBeforeUnmount(() => removeEventListener('pointerdown', away));
</script>

<template>
  <header class="topbar">
    <!-- Keep it a button: it is the way home from anywhere. -->
    <button class="mark" @click="$emit('home')">
      <Wordmark :size="26" />
    </button>

    <div class="right">
      <button v-if="admin" class="btn ghost" @click="$emit('admin')">Manage users</button>

      <div ref="wrap" class="theme" @keydown.esc="menu = false">
        <button class="pick" :title="`Theme: ${theme}`" :aria-expanded="menu"
                @click="menu = !menu">{{ GLYPH[resolved] }}</button>
        <ul v-if="menu" class="menu">
          <li v-for="c in CHOICES" :key="c.value">
            <button :class="{ on: theme === c.value }"
                    @click="theme = c.value; menu = false">
              <span class="tick">{{ theme === c.value ? '✓' : '' }}</span>{{ c.label }}
            </button>
          </li>
        </ul>
      </div>
      <!-- Today's, not the lifetime total: a number that only ever goes up stops being
           worth looking at, and one that starts again each morning is an invitation to do
           something today. It sits beside the person because it is a fact about them
           rather than about whatever course happens to be open - which is also why it is
           counted across all of them. -->
      <span ref="ring" class="ring" :class="{ sweeping }">
        <span class="xp" title="XP earned today">
          <strong>{{ shown.toLocaleString() }}</strong> XP today
        </span>
      </span>

      <div v-if="label" class="who">
        <span class="avatar">{{ initials }}</span>
        <span class="name">{{ label }}</span>
      </div>
      <button v-if="authed" class="btn ghost" @click="$emit('signout')">Sign out</button>
    </div>
  </header>
</template>

<style scoped>
/* Not `.bar`: a parent's scoped styles also apply to a child component's root element, and
   App.vue has a `.bar` for the progress meter. That collision put a 999px radius on the
   corners of the top bar and would have kept finding new ways to be wrong. */
.topbar { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 52px;
          background: var(--ice-bg-soft); border-bottom: 1px solid var(--ice-border); }
.mark { display: flex; align-items: center; gap: 10px; background: none; border: 0;
        padding: 6px 8px; margin-left: -8px; border-radius: 8px; cursor: pointer;
        color: var(--ice-fg); font: inherit; }
.mark:hover { background: var(--ice-bg); }

.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
/* The ring is the wrapper, so the pill keeps its own background and nothing moves when
   the sweep starts: the 2px is always there, and only the gradient inside it appears. */
.ring { padding: 2px; border-radius: 999px; background: transparent; }
.ring.sweeping { background: conic-gradient(from -90deg, var(--ice-primary) var(--sweep, 0deg), transparent 0); }

.xp { display: flex; align-items: baseline; gap: 4px; padding: 4px 9px; border-radius: 999px;
      background: var(--ice-primary-soft); color: var(--ice-fg-muted);
      font-size: 11px; white-space: nowrap; }
/* Tabular figures, or a counting number changes width on every frame and shoves the avatar
   beside it along with it. */
.xp strong { font-family: var(--ice-font-mono); font-variant-numeric: tabular-nums;
             font-size: 12px; color: var(--ice-fg); }

/* A student who has asked for less motion gets the number and nothing else. */
@media (prefers-reduced-motion: reduce) {
  .ring.sweeping { background: transparent; }
}

@media (max-width: 720px) {
  .name { display: none; }
  /* The count survives; the words go. It is the number that is worth the room. */
  .xp { font-size: 0; gap: 0; padding: 4px 8px; }
}
</style>
