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
  /* Somebody else's session is being viewed. The counter is hidden rather than zeroed:
   * today's XP is derived from rows filtered by an instant and the admin route answers per
   * course, so it is a number this side does not have - and a nought would read as a
   * student who has done nothing today, which is a different claim entirely. */
  watching: Boolean,
});
defineEmits(['home', 'admin', 'account', 'signout']);

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

/* The person is now a menu rather than a label, because the account screen needed a way in
 * and the corner already had this exact behaviour sitting next to it. Sign out moved into
 * it: it was a button of its own beside a chip that did nothing, which is the wrong way
 * round - the chip is the thing about you, so the things you can do about yourself belong
 * under it. */
const mine = ref(false);
const mineWrap = ref(null);

/* ONE listener for both menus rather than one each. Two would each have to know not to
 * close the other's click, and the bug that produces is a menu that will not open because
 * the gesture that opened it also closed it. */
const away = e => {
  if (!wrap.value?.contains(e.target)) menu.value = false;
  if (!mineWrap.value?.contains(e.target)) mine.value = false;
};
/* Opening one closes the other. Both hang off the same corner and would otherwise overlap. */
const openMine = () => { menu.value = false; mine.value = !mine.value; };
const openTheme = () => { mine.value = false; menu.value = !menu.value; };
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
                @click="openTheme">{{ GLYPH[resolved] }}</button>
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
      <span v-if="!watching" ref="ring" class="ring" :class="{ sweeping }">
        <span class="xp" title="XP earned today">
          <strong>{{ shown.toLocaleString() }}</strong> XP today
        </span>
      </span>

      <div v-if="label" ref="mineWrap" class="who" @keydown.esc="mine = false">
        <button class="chip" :aria-expanded="mine" @click="openMine">
          <span class="avatar">{{ initials }}</span>
          <span class="name">{{ label }}</span>
        </button>
        <ul v-if="mine" class="menu">
          <!-- Hidden while watching somebody, and not disabled: this screen is always about
               the person signed in, so from inside a student's session it would offer the
               ADMIN's account under the student's name. See subject.js. -->
          <li v-if="!watching">
            <button @click="mine = false; $emit('account')">Your account</button>
          </li>
          <li v-if="authed">
            <button @click="mine = false; $emit('signout')">Sign out</button>
          </li>
        </ul>
      </div>
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

/* THE DROPDOWNS, WHICH HAD NO CSS AT ALL until the account screen needed a second one.
 *
 * The theme picker has been shipping as an unstyled <ul> in normal flow: no positioning, no
 * surface, list bullets, and opening it pushed the bar's own layout around. Exactly what
 * `.avatar` was doing before it was found - markup with class names that read as though
 * they were styled somewhere, and were not.
 *
 * Absolute against the wrapper, which is why both wrappers are `position: relative` and why
 * neither may be a plain flex child. Anchored to the RIGHT edge: the bar's contents grow
 * leftward from the corner, so a menu pinned left would hang off the window on a long
 * name. */
.theme { position: relative; }
.pick { font: inherit; font-size: 14px; line-height: 1; width: 30px; height: 30px;
        display: inline-flex; align-items: center; justify-content: center;
        background: none; border: 1px solid transparent; border-radius: 8px;
        color: var(--ice-fg); cursor: pointer; }
.pick:hover { background: var(--ice-bg); border-color: var(--ice-border); }

.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
        list-style: none; margin: 0; padding: 4px; min-width: 160px;
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
        border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
.menu button { display: flex; align-items: center; gap: 8px; width: 100%; font: inherit;
               font-size: 13px; text-align: left; padding: 7px 9px; border-radius: 7px;
               background: none; border: 0; color: var(--ice-fg); cursor: pointer;
               white-space: nowrap; }
.menu button:hover { background: var(--ice-raise); }
.menu button.on { color: var(--ice-fg); font-weight: 500; }
/* A fixed column for the tick, so the labels line up whether or not one is in front of
   them - without it the chosen row is indented past the other two. */
.tick { flex: none; width: 12px; color: var(--ice-primary); }
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

/* The initials, and the thing it has to survive is ONE letter as well as two.
 *
 * Width and height are set outright rather than left to padding: padding sizes the box to
 * its text, so "K" comes out an oval and "KV" a lozenge, and only a two-initial name ever
 * looks round. `flex: none` for the same reason from the other side - a long name beside it
 * would otherwise squash the circle into an ellipse.
 *
 * No letter-spacing. Tracking adds its gap after the last glyph too, which shunts centred
 * text left by half of it - visible at 26px, and it reads as the circle being off rather
 * than the letters. */
.who { position: relative; min-width: 0; }
.chip { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 220px;
        font: inherit; background: none; border: 0; padding: 4px 6px; border-radius: 999px;
        color: var(--ice-fg); cursor: pointer; }
.chip:hover { background: var(--ice-bg); }
.avatar { flex: none; width: 26px; height: 26px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--ice-primary-soft); color: var(--ice-primary-strong);
          font-size: 10.5px; font-weight: 600; line-height: 1; }
.name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
