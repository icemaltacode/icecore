<script setup>
/* The landing screen: everything a student is enrolled on, as cards.
 *
 * It is the home of the app rather than a chooser that only appears when there is
 * something to choose - a student with one course still lands here, and the sidebar keeps
 * a way back. Opening a course puts ?course= in the URL, so returning to the tab resumes
 * where they were instead of coming through here again.
 */
import { courseImage } from '../content.js';

const props = defineProps({
  courses: Array,
  /** id -> { done, xp }. Absent while it is still being fetched. */
  progress: Object,
  loading: Boolean,
  error: String,
});
defineEmits(['open']);

const done = c => props.progress?.[c.id]?.done ?? 0;
const pct = c => (c.exercises ? done(c) / c.exercises * 100 : 0);
/* What this course has earned them, which is recorded rather than summed from the content -
 * see progress.js. Nothing on a card knows what a course is worth in total, and it does not
 * need to: the bar beside it already says how far through they are. */
const xp = c => props.progress?.[c.id]?.xp ?? 0;

/* A course with nothing gradable in it is announced, not broken. That is what a course
 * repo looks like before its material is written: a course.json and a cover image, which
 * is enough to publish a card and nothing else. Derived from the count rather than from a
 * flag in course.json, so a course stops being announced by having exercises rather than
 * by someone remembering to unset something.
 *
 * It is not clickable. There is no first exercise to open, and a card that opens an empty
 * course reads as a fault rather than as a promise.
 *
 * A PLAYGROUND HAS NO EXERCISES AND NEVER WILL, so the count alone would announce it
 * forever. It opens instead, and says what it is where the progress bar would be - there is
 * nothing to be part-way through in a sandbox, and a bar stuck at zero would say there is. */
const announced = c => !c.exercises && !c.playground;

/* No image is a normal state, not a broken one, so the fallback has to look chosen. A hue
 * off the course id keeps each course's tile the same colour every time it is drawn. */
const hue = id => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
const monogram = title => (title || '?').trim()[0].toUpperCase();
</script>

<template>
  <div class="page">
    <main>
      <h1>Your courses</h1>

      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="err">{{ error }}</p>

      <div v-else class="grid">
        <button v-for="c in courses" :key="c.id" class="card"
                :class="{ announced: announced(c) }" :disabled="announced(c)"
                @click="$emit('open', c.id)">
          <span class="cover">
            <img v-if="c.image" :src="courseImage(c.image)" alt="" loading="lazy">
            <span v-else class="fallback"
                  :style="{ '--h': hue(c.id) }">{{ monogram(c.title) }}</span>
          </span>
          <span class="body">
            <strong>{{ c.title }}</strong>
            <small v-if="c.blurb">{{ c.blurb }}</small>
            <template v-if="announced(c)">
              <small class="tally soon">Coming soon</small>
            </template>
            <template v-else-if="c.playground">
              <small class="tally sandbox">Sandbox</small>
            </template>
            <template v-else>
              <span class="bar"><i :style="{ width: pct(c) + '%' }"></i></span>
              <span class="tallies">
                <small class="tally">{{ done(c) }} of {{ c.exercises }} complete</small>
                <!-- Hidden at zero: on a course nobody has started it is a label for a
                     thing that has not happened yet, and the bar already says that. -->
                <small v-if="xp(c)" class="tally earned">{{ xp(c).toLocaleString() }} XP</small>
              </span>
            </template>
          </span>
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; overflow: auto; display: flex; flex-direction: column; }
main { width: 100%; max-width: 1080px; margin: 0 auto; padding: 32px 28px 56px; }
h1 { margin: 0 0 24px; font-size: 22px; }
.muted { color: var(--ice-fg-muted); }
.err { color: var(--ice-bad); }

.grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(216px, 1fr)); }
.card { display: flex; flex-direction: column; gap: 0; text-align: left; padding: 0;
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
        border-radius: var(--ice-radius); overflow: hidden; cursor: pointer;
        color: var(--ice-fg); font: inherit; transition: border-color .12s, transform .12s; }
.card:hover { border-color: var(--ice-primary-soft); transform: translateY(-2px); }

/* Square, and cropped to it: the contract says square, and an image that isn't should
   still fill the tile rather than letterbox inside it. */
.cover { display: block; aspect-ratio: 1; background: var(--ice-bg); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fallback { display: grid; place-items: center; width: 100%; height: 100%;
            /* Not a token: the tile behind it is always a mid-tone hue, in either theme. */
            font-size: 56px; font-weight: 600; color: #06121e;
            background: linear-gradient(140deg,
              hsl(var(--h) 70% 62%), hsl(calc(var(--h) + 40) 65% 44%)); }

.body { display: flex; flex-direction: column; gap: 6px; padding: 14px 15px 16px; }
.body strong { font-size: 14px; line-height: 1.35; }
.body small { color: var(--ice-fg-muted); font-size: 11.5px; line-height: 1.45; }
.bar { display: block; height: 4px; margin-top: 4px; border-radius: 999px;
       background: var(--ice-bg); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ice-primary); transition: width .3s; }
.tallies { display: flex; align-items: baseline; gap: 8px; }
.tally { font-family: var(--ice-font-mono); font-size: 10px; }
/* `.body small` above is more specific than a bare class, so the accent has to be at
   least as specific or the XP comes out the same grey as the tally beside it. */
.body .earned { margin-left: auto; color: var(--ice-primary-strong); font-weight: 600; }

/* Announced, not disabled-looking: the card is still the most interesting thing on the
   page and the art is the point of it. Only the affordances go - no lift, no pointer -
   and the cover is dimmed just enough to read as not-yet rather than as unavailable. */
.card.announced { cursor: default; }
.card.announced:hover { border-color: var(--ice-border); transform: none; }
.card.announced .cover { opacity: .62; }
.tally.soon { color: var(--ice-primary-strong); letter-spacing: .06em; text-transform: uppercase; }
/* Muted rather than accented: "Sandbox" is a description of the card, where "Coming soon"
   is news about it. */
.tally.sandbox { color: var(--ice-fg-muted); letter-spacing: .06em; text-transform: uppercase; }
</style>
