<script setup>
/* A section's slides, as a step in the run rather than a panel beside it.
 *
 * The deck is one built Slidev site per topic, and every deck sets `routerMode: hash`, so
 * a section is addressed by appending `#/<n>` and resolved entirely client-side. No
 * CloudFront rewrite, no redirect rules, nothing to deploy - which was the expected blocker
 * for this whole feature and turned out not to be one.
 *
 * The iframe is same-origin, so the signed cookies that unlock content unlock the deck too.
 * It is also why the student can page through the section with the deck's own keyboard
 * shortcuts once they have clicked into it.
 */
import { computed } from 'vue';

const props = defineProps({
  /* `slides` off the topic - `slides/1.1.1/index.html`, or an absolute URL when a deck
   * lives somewhere else entirely. */
  deck: String,
  row: Object,     // the walk row: title, slide, end
});

const base = computed(() => /^https?:\/\//.test(props.deck || '')
  ? props.deck
  : `${import.meta.env.BASE_URL}${props.deck}`);
const src = computed(() => `${base.value}#/${props.row.slide}`);
const count = computed(() => (props.row.end - props.row.slide) + 1);
</script>

<template>
  <article class="step">
    <header>
      <span class="eyebrow">Slides</span>
      <h2>{{ row.title }}</h2>
      <span class="count">{{ count }} slide{{ count === 1 ? '' : 's' }}</span>
      <a class="link" :href="src" target="_blank" rel="noopener">Open in a tab</a>
    </header>
    <!-- Keyed on src so moving between two sections of the same deck reloads the frame at
         the new hash. Without it the iframe keeps its old location: same document, and the
         router has already consumed the hash it booted with. -->
    <iframe :key="src" :src="src" :title="`Slides: ${row.title}`"></iframe>
  </article>
</template>

<style scoped>
.step { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; height: 100%; }
header { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px 12px; }
.eyebrow { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
           font-family: var(--ice-font-mono); color: var(--ice-primary-strong); }
h2 { margin: 0; font-size: 18px; line-height: 1.3; }
.count { font-size: 11px; font-family: var(--ice-font-mono); color: var(--ice-fg-muted); }
.link { margin-left: auto; font-size: 12px; color: var(--ice-fg-muted); }
.link:hover { color: var(--ice-fg); }
/* White behind it deliberately: a deck is its own site with its own light theme, and the
   player's dark ground showing through while it loads reads as a broken frame. */
iframe { width: 100%; height: 100%; border: 0; min-height: 0; background: #fff;
         border-top: 1px solid var(--ice-border); }
</style>
