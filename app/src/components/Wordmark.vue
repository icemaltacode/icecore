<script setup>
/* The logo and the name, together, wherever the product identifies itself.
 *
 * SHARED because there are two of them - the top bar and the sign-in card - and they were
 * written out twice, each with its own copy of a blue placeholder square and the string
 * "ICE Practice". The sign-in card is the first thing a student ever sees and the top bar is
 * on every page after it; a brand that differs between the two reads as two products. Same
 * argument as `Badge.vue` and `DeckActions.vue`.
 *
 * The name is set in lowercase as a literal, NOT with `text-transform`. It is a wordmark -
 * "icecore" is how it is spelled, not a styling of "Icecore" - so a screen reader, a
 * copy-paste and a page title should all get the same seven characters. `text-transform`
 * would leave the real text saying something else.
 *
 * The image is imported rather than referenced by path: Vite emits it with a content hash,
 * so a changed logo can never be served from a stale cache. That also means it cannot live
 * in `app/public/` - `icecore dev` points publicDir at the course's staging directory, so
 * the app's own public/ is never served, which is the same trap the grader's wheels hit.
 */
import logo from '../assets/icecore-logo.png';

defineProps({
  /* The top bar's is a button home; the sign-in card's is not interactive. */
  size: { type: Number, default: 26 },
});
</script>

<template>
  <span class="wordmark">
    <img :src="logo" :style="{ height: `${size}px` }" alt="" aria-hidden="true">
    <span class="name" :style="{ fontSize: `${Math.round(size * 0.72)}px` }">icecore</span>
  </span>
</template>

<style scoped>
.wordmark { display: inline-flex; align-items: center; gap: 9px; }
.wordmark img { display: block; width: auto; }
/* Outfit for the name only. The body text stays on the system stack - a webfont buys
   nothing at 13px in a table of exercises, and costs a render-blocking request on every
   page. `font-display: swap` on the face means the wordmark shows in the fallback first
   rather than not at all, which is why the fallback is a geometric-ish stack of its own. */
.name { font-family: 'Outfit', 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-weight: 600; letter-spacing: -.015em; line-height: 1;
        color: var(--ice-fg); }
</style>
