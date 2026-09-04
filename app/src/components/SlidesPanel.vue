<script setup>
/* The unit's deck, alongside the exercise rather than instead of it.
 *
 * An iframe, deliberately: a built Slidev deck is its own small site with its own router
 * and asset paths, and it is served from the same origin so the signed cookies that unlock
 * content unlock it too. Keyboard focus belongs to whichever of the two panes was last
 * clicked, which is the behaviour a mouse gives you for free.
 *
 * WHICH EDGE IT TAKES IS THE VIEWER'S, not the layout's. A slide is 16:9, so beside a
 * 34%-wide brief and an editor on a laptop it is a stamp, and under them on an ultrawide it
 * wastes the width nothing else is using. The panel does not own the answer - App.vue holds
 * it and remembers it, because the split it is a pane of is what actually moves - so this
 * only says which way round it currently is and asks for the other.
 */
import DeckActions from './DeckActions.vue';
import Icon from './Icon.vue';

const props = defineProps({
  src: String,
  label: String,
  /** 'right' or 'bottom' - which edge of the stage the deck has. */
  side: { type: String, default: 'right' },
});
const emit = defineEmits(['close', 'flip']);
</script>

<template>
  <aside class="slides" :class="side">
    <div class="bar">
      <span class="label">{{ label }}</span>
      <!-- The same control the notes panel carries, down to the icon: it shows the shape it
           would MOVE to, not the shape it is in, which is how a toggle that changes a layout
           reads without a label on it. -->
      <button class="flip" :title="side === 'right' ? 'Move the slides below' : 'Move the slides beside'"
              @click="emit('flip')">
        <Icon :name="side === 'right' ? 'rows' : 'columns'" :size="15" />
      </button>
      <DeckActions :deck="props.src" :name="props.label" />
      <button class="link" @click="emit('close')">Close</button>
    </div>
    <iframe :src="src" :title="`Slides for ${label}`"></iframe>
  </aside>
</template>

<style scoped>
/* The divider belongs to whichever edge the exercise is on, or the panel carries a line down
   a side with nothing beyond it and the SplitPane handle draws a second one beside it. */
.slides { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;
          background: var(--ice-bg-soft); }
.bar { display: flex; align-items: center; gap: 14px; padding: 0 12px;
       border-bottom: 1px solid var(--ice-border); }
.label { font-size: 12px; padding: 9px 0; margin-right: auto; color: var(--ice-fg-muted);
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Same geometry as DeckActions' own buttons, which it sits beside: a control two pixels
   different from its neighbour reads as misaligned rather than as distinct. */
.flip { display: grid; place-items: center; width: 28px; height: 28px; margin-right: -6px;
        border-radius: var(--ice-radius); color: var(--ice-fg-muted);
        background: none; border: 0; cursor: pointer; }
.flip:hover { color: var(--ice-fg); background: var(--ice-raise-strong); }
.flip:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
iframe { flex: 1; width: 100%; border: 0; min-height: 0; background: #fff; }
</style>
