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
import { computed, ref, onBeforeUnmount } from 'vue';

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

/* A section is ONE step in the run but several slides, and the deck's own controls are
 * hidden until the mouse moves inside it - so without this the student sees the section's
 * first slide, no way to reach the rest, and a Next button that skips them entirely.
 *
 * The frame is same-origin (see the note on the sandbox in CLAUDE.md), so the hash can be
 * set directly and a hashchange listener keeps this in step with the deck's own keyboard
 * navigation rather than fighting it. */
const frame = ref(null);
const at = ref(props.row.slide);

const read = () => {
  const m = frame.value?.contentWindow?.location.hash.match(/^#\/(\d+)/);
  at.value = m ? Number(m[1]) : props.row.slide;
};
const onLoad = () => {
  read();
  frame.value?.contentWindow?.addEventListener('hashchange', read);
};
onBeforeUnmount(() => frame.value?.contentWindow?.removeEventListener('hashchange', read));

/* Clamped to the section. Paging past its end would walk into the next section's slides,
 * which the run reaches on its own terms a few steps later. */
const go = d => {
  const to = Math.min(Math.max(at.value + d, props.row.slide), props.row.end);
  const w = frame.value?.contentWindow;
  if (w) { w.location.hash = `#/${to}`; at.value = to; }
};
const pos = computed(() =>
  Math.min(Math.max(at.value - props.row.slide + 1, 1), count.value));
</script>

<template>
  <article class="slidestep">
    <header>
      <span class="eyebrow">Slides</span>
      <h2>{{ row.title }}</h2>
      <div class="pager">
        <button class="page" :disabled="at <= row.slide" title="Previous slide"
                @click="go(-1)">&lsaquo;</button>
        <span class="count">{{ pos }} / {{ count }}</span>
        <button class="page" :disabled="at >= row.end" title="Next slide"
                @click="go(1)">&rsaquo;</button>
      </div>
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
.slidestep .count { font-size: 11px; font-family: var(--ice-font-mono);
                    color: var(--ice-fg-muted); min-width: 42px; text-align: center; }
/* The deck's own controls only fade in on mouse movement inside the frame, which is not an
   affordance a student will find. This one is always there. */
.slidestep .pager { display: flex; align-items: center; gap: 2px; }
.slidestep .page { width: 24px; height: 22px; display: grid; place-items: center; cursor: pointer;
                   background: var(--ice-bg); border: 1px solid var(--ice-border);
                   border-radius: 6px; color: var(--ice-fg-muted); font-size: 13px; line-height: 1; }
.slidestep .page:hover:not(:disabled) { color: var(--ice-fg); border-color: var(--ice-primary-soft); }
.slidestep .page:disabled { opacity: .35; cursor: not-allowed; }
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
