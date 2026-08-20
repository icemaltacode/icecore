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
import { computed, ref } from 'vue';

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

/* SHOW SLIDEV'S OWN CONTROL BAR.
 *
 * The deck already has everything: previous/next, slide overview, presenter mode with the
 * speaker notes, the drawing toolbar, fullscreen. Slidev just hides the bar behind
 * `opacity-0 hover:opacity-100`, which is right for a deck filling a screen and wrong
 * inside a frame, where a student has no reason to sweep the pointer into the corner to
 * discover it. So the only thing needed here is to stop it being invisible - not to
 * reimplement any of it.
 *
 * The frame is same-origin, so a stylesheet can simply be added to it. Structural selector
 * rather than the utility classes Slidev happens to compile (`.absolute.bottom-0`), because
 * those are an implementation detail and this should not need touching when they change. */
const frame = ref(null);
const REVEAL = `.slidev-slide-container > div:has(nav .slidev-icon-btn) { opacity: 1 !important; }`;

const onLoad = () => {
  const doc = frame.value?.contentDocument;
  if (!doc || doc.getElementById('ice-reveal-controls')) return;
  const style = doc.createElement('style');
  style.id = 'ice-reveal-controls';
  style.textContent = REVEAL;
  doc.head.appendChild(style);
};
</script>

<template>
  <article class="slidestep">
    <header>
      <span class="eyebrow">Slides</span>
      <h2>{{ row.title }}</h2>
      <span class="count">{{ count }} slide{{ count === 1 ? '' : 's' }}</span>
      <a class="link" :href="src" target="_blank" rel="noopener">Open in a tab</a>
    </header>
    <!-- The frame is held at 16:9 rather than filled to the pane. A deck letterboxes itself
         to that ratio against a BLACK #slide-container, so any other shape puts black bands
         above and below the slide, with Slidev's own controls sitting in them - which reads
         as the deck using the wrong theme. Giving it exactly the shape it renders at means
         there is no letterbox to colour, and the controls sit over the slide where they
         were designed to. What is left over is the player's own themed ground. -->
    <div class="frame">
      <!-- Keyed on src so moving between two sections of the same deck reloads the frame at
           the new hash. Without it the iframe keeps its old location: same document, and the
           router has already consumed the hash it booted with. -->
      <iframe ref="frame" :key="src" :src="src" :title="`Slides: ${row.title}`"
              @load="onLoad"></iframe>
    </div>
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
/* Centres the deck in whatever space the pane has, and owns the surround. */
.slidestep .frame { display: grid; place-items: center; min-height: 0; overflow: hidden;
                    padding: 0 20px 20px; border-top: 1px solid var(--ice-border); }
/* aspect-ratio with both maxima: wide panes are limited by height and tall ones by width,
   so the frame is always exactly 16:9 and never overflows in either direction.
   White behind it deliberately - a deck is its own site with its own light theme, and the
   player's dark ground showing through while it loads reads as a broken frame. */
.slidestep iframe { aspect-ratio: 16 / 9; width: 100%; height: auto;
         max-width: 100%; max-height: 100%; border: 0; background: #fff;
         border-radius: var(--ice-radius); box-shadow: 0 2px 18px var(--ice-scrim); }
</style>
