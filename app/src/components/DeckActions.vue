<script setup>
/* What a student can do with a deck other than read it here: open it in a tab, or take the
 * PDF away.
 *
 * SHARED BECAUSE THERE ARE TWO PLACES A DECK APPEARS - as a step in the run
 * (`SlidesStep`) and as a panel beside an exercise (`SlidesPanel`) - and the same reasoning
 * as `Badge.vue` applies: a control that differs between them reads as a different deck
 * rather than the same one. The two copies of "Open in a tab" had already been written
 * twice, which is how a second copy starts.
 *
 * THE PDF IS DERIVED FROM THE DECK, NOT FROM A FLAG. Every deck is exported alongside its
 * build - `icecore slides` fails rather than producing one without the other - so a topic
 * that has a deck has a PDF, and neither the builder nor the player needs to record it.
 * That is the same decoupling CLAUDE.md insists on for the Slides button itself: derive the
 * affordance from the source, never from whether some output happens to be sitting there.
 *
 * `download` rather than a plain link, so the browser saves it instead of opening the PDF
 * viewer over the top of the player and losing the student's place. It only has that effect
 * same-origin, which a deck always is - the signed cookies that unlock content are what
 * unlock the deck too, and a cross-origin deck could not be downloaded with them anyway.
 */
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({
  /* The deck's own URL - `slides/1.1.1/index.html`, or an absolute URL for a deck that
   * lives somewhere else entirely. */
  deck: String,
  /* Where "open in a tab" should go. The same deck, but a slide step points at its own
   * section's hash rather than the deck's first slide. */
  open: String,
  /* What the saved file should be called. Without it every topic's download lands in the
   * same folder as slides.pdf, then slides(1).pdf, and the student has no way to tell which
   * is which. */
  name: String,
});

const href = computed(() => props.open || props.deck);

/* A DECK WE DID NOT BUILD HAS NO PDF OF OURS. `slides:` may be set to an absolute URL for a
 * deck hosted somewhere else entirely, and nothing exported that one - deriving a
 * `slides.pdf` beside it would offer a download that 404s, and `download` is ignored
 * cross-origin anyway so the student would get the file opened rather than saved. Same test
 * the app already uses to decide whether to prefix BASE_URL. */
const own = computed(() => !/^https?:\/\//.test(String(props.deck || '')));

const pdf = computed(() => {
  const dir = String(props.deck || '').replace(/index\.html?$/i, '');
  return `${dir}${dir.endsWith('/') ? '' : '/'}slides.pdf`;
});
/* A filename, not a title: slashes and colons are not allowed in one and a topic label is
 * full of both. */
const filename = computed(() =>
  `${String(props.name || 'slides').replace(/[\\/:*?"<>|]+/g, '-').trim()}.pdf`);
</script>

<template>
  <span class="deckactions">
    <a class="deckbtn" :href="href" target="_blank" rel="noopener"
       title="Open in a tab" aria-label="Open in a tab">
      <Icon name="tab" :size="15" />
    </a>
    <a v-if="own" class="deckbtn" :href="pdf" :download="filename"
       title="Download as PDF" aria-label="Download as PDF">
      <Icon name="download" :size="15" />
    </a>
  </span>
</template>

<style scoped>
/* Unique root class, for the reason SlidesStep spells out at length: Vue's scoped CSS still
   reaches a child component's root, so a name another component also uses gets that
   component's geometry applied to this one. */
.deckactions { display: inline-flex; align-items: center; gap: 2px; }
.deckbtn { display: grid; place-items: center; width: 28px; height: 28px;
           border-radius: var(--ice-radius); color: var(--ice-fg-muted);
           background: none; border: 0; cursor: pointer; }
.deckbtn:hover { color: var(--ice-fg); background: var(--ice-bg-soft); }
.deckbtn:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
</style>
