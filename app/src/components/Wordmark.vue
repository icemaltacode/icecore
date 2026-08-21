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
    <!-- ONE LINE, NO WHITESPACE BETWEEN THE SPANS. HTML collapses a newline into a space,
         so splitting these across lines would make it read "ice core" to a screen reader
         and to anyone copying it. The two-tone is decoration; the word is still one word. -->
    <span class="name" :style="{ fontSize: `${Math.round(size * 0.72)}px` }"><span class="ice">ice</span><span class="core">core</span></span>
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
        font-weight: 600; letter-spacing: -.015em; line-height: 1; white-space: nowrap; }
/* Two tones so the compound reads as ice + core rather than one seven-letter run.
 *
 * `--ice-mark` rather than `--ice-primary`, and the difference was measured rather than
 * eyeballed. Two constraints pull against each other: the half has to be legible on the
 * bar's own ground AND distinct from the other half. Primary fails the first in light
 * (3.91:1 on #f8fafc, under AA for anything but large text) and fails the second in dark
 * (1.96:1 against near-white `core`, so the halves flatten back into one word). The token
 * resolves to 5.67:1 / 3.01:1 in light and 6.40:1 / 2.53:1 in dark - comfortable on both
 * counts in both themes, which no single existing blue managed.
 *
 * Still blue, because the mark beside it is blue and the tint should read as deliberate
 * rather than as a link. Neither half is muted: greying one would say the word is
 * half-important, rather than that it has two parts. */
.ice  { color: var(--ice-mark); }
.core { color: var(--ice-fg); }
</style>
