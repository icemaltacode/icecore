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
  <article class="slidestep">
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
/* THE ROOT CLASS HAS TO BE UNIQUE ACROSS THE WHOLE APP, not just unique in here.
 *
 * Vue's scoped CSS still reaches a child component's ROOT element - that is deliberate, so
 * a parent can position the child it renders. So App.vue's rules land on this <article>.
 * It was `class="step"`, and App.vue scopes `.step { width: 26px; height: 22px }` for the
 * topic-hop buttons in the sidebar. The frame rendered, the deck inside it booted fine, and
 * the whole thing was laid out at 26x22 pixels - a blank strip under a correct header,
 * which reads as "the deck failed to load" and sends you looking at iframes and CORS.
 *
 * Same shape as App.vue's `.bar` once rounding TopBar's corners, because TopBar's root
 * happened to be <header class="bar">. Pick a name nothing else would choose. */
.slidestep { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; height: 100%; }
.slidestep > header { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px 12px; }
.slidestep .eyebrow { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
           font-family: var(--ice-font-mono); color: var(--ice-primary-strong); }
.slidestep h2 { margin: 0; font-size: 18px; line-height: 1.3; }
.slidestep .count { font-size: 11px; font-family: var(--ice-font-mono); color: var(--ice-fg-muted); }
.slidestep .link { margin-left: auto; font-size: 12px; color: var(--ice-fg-muted); }
.slidestep .link:hover { color: var(--ice-fg); }
/* White behind it deliberately: a deck is its own site with its own light theme, and the
   player's dark ground showing through while it loads reads as a broken frame. */
.slidestep iframe { width: 100%; height: 100%; border: 0; min-height: 0; background: #fff;
         border-top: 1px solid var(--ice-border); }
</style>
