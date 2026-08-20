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
  /** id -> number solved. Absent while it is still being fetched. */
  progress: Object,
  admin: Boolean,
  authed: Boolean,
  loading: Boolean,
  error: String,
});
defineEmits(['open', 'admin', 'signout']);

const done = c => props.progress?.[c.id] ?? 0;
const pct = c => (c.exercises ? done(c) / c.exercises * 100 : 0);

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
    <header>
      <div class="brand">
        <span class="dot"></span>
        <strong>ICE Practice</strong>
      </div>
      <div class="actions">
        <button v-if="admin" class="btn ghost" @click="$emit('admin')">Manage enrolment</button>
        <button v-if="authed" class="btn ghost" @click="$emit('signout')">Sign out</button>
      </div>
    </header>

    <main>
      <h1>Your courses</h1>

      <p v-if="loading" class="muted">Loading…</p>
      <p v-else-if="error" class="err">{{ error }}</p>

      <div v-else class="grid">
        <button v-for="c in courses" :key="c.id" class="card" @click="$emit('open', c.id)">
          <span class="cover">
            <img v-if="c.image" :src="courseImage(c.image)" alt="" loading="lazy">
            <span v-else class="fallback"
                  :style="{ '--h': hue(c.id) }">{{ monogram(c.title) }}</span>
          </span>
          <span class="body">
            <strong>{{ c.title }}</strong>
            <small v-if="c.blurb">{{ c.blurb }}</small>
            <span class="bar"><i :style="{ width: pct(c) + '%' }"></i></span>
            <small class="tally">{{ done(c) }} of {{ c.exercises }} complete</small>
          </span>
        </button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page { height: 100%; overflow: auto; display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 12px; padding: 16px 28px;
         border-bottom: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.brand { display: flex; gap: 10px; align-items: center; }
.dot { width: 12px; height: 12px; border-radius: 3px; background: var(--ice-primary); }
.actions { margin-left: auto; display: flex; gap: 8px; }

main { width: 100%; max-width: 1080px; margin: 0 auto; padding: 32px 28px 56px; }
h1 { margin: 0 0 24px; font-size: 22px; }
.muted { color: var(--ice-fg-muted); }
.err { color: #fca5a5; }

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
            font-size: 56px; font-weight: 600; color: #06121e;
            background: linear-gradient(140deg,
              hsl(var(--h) 70% 62%), hsl(calc(var(--h) + 40) 65% 44%)); }

.body { display: flex; flex-direction: column; gap: 6px; padding: 14px 15px 16px; }
.body strong { font-size: 14px; line-height: 1.35; }
.body small { color: var(--ice-fg-muted); font-size: 11.5px; line-height: 1.45; }
.bar { display: block; height: 4px; margin-top: 4px; border-radius: 999px;
       background: var(--ice-bg); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ice-primary); transition: width .3s; }
.tally { font-family: var(--ice-font-mono); font-size: 10px; }
</style>
