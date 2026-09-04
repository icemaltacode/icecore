<script setup>
/* THE EDUCATOR'S POINTER, drawn on the screen they are driving.
 *
 * IN ADDITION TO THE STUDENT'S OWN, never instead of it. Nothing here touches the real
 * cursor: this is a mark on the page that happens to follow somebody else's hand, and the
 * student goes on pointing and clicking with their own exactly as before. Two cursors on one
 * screen is the honest picture of what is happening - two people are looking at it.
 *
 * THE SAME ORANGE AS THE CARET, and for the same reason the selection reuses it: one hue
 * means "somebody else is driving this", and a second would read as a second thing going on.
 *
 * FIXED-POSITIONED AND `pointer-events: none`. It sits over the whole page and must never be
 * in the way of the thing it is pointing at - a student who cannot click a button because
 * their tutor's cursor is on it would be a cruel bug.
 *
 * IT DOES NOT ANIMATE BETWEEN FRAMES. Fifteen a second is already motion; a transition on top
 * of it would put the dot permanently a fraction behind the hand, which on a gesture that
 * lands on something is the difference between pointing at it and pointing near it. The only
 * transition is the fade when the pointer leaves.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { pointer } from '../delivery.js';
import { placeAt } from '../pointer.js';

const props = defineProps({
  /** Whose hand it is. Shown beside the dot, exactly as the caret's label is. */
  name: String,
});

/* Recomputed on every point AND on a resize, because the region it is a fraction OF moves
 * when the window does - a dot that stayed put while the layout reflowed under it would be
 * pointing at whatever slid beneath it. */
const tick = ref(0);
const spot = computed(() => {
  tick.value;                                   // a dependency, deliberately
  return placeAt(pointer.region ? pointer : null);
});

const bump = () => { tick.value++; };
watch(() => [pointer.region, pointer.x, pointer.y], bump);
onMounted(() => addEventListener('resize', bump));
onUnmounted(() => removeEventListener('resize', bump));
</script>

<template>
  <!-- Rendered only when there is somewhere to put it. A region the student does not have on
       screen - a panel they have closed, a pane this kind of exercise does not have - draws
       nothing, which is the answer naming a region rather than a fraction of a window buys. -->
  <div v-if="spot" class="peerpointer" :style="{ left: `${spot.left}px`, top: `${spot.top}px` }">
    <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
      <!-- An arrow, not a dot: it is a CURSOR, and the shape is what says so at a glance on a
           page that already has coloured marks on it. The white edge is what keeps it legible
           over a dark editor and a white slide both. -->
      <path d="M2 1.5 L2 15.5 L6 12 L8.6 17.6 L11.4 16.4 L8.9 11 L14 11 Z"
            fill="var(--ice-drive-line)" stroke="#fff" stroke-width="1.4"
            stroke-linejoin="round" />
    </svg>
    <span v-if="name" class="who">{{ name }}</span>
  </div>
</template>

<style scoped>
/* A root class nothing else in the app would choose - Vue's scoped CSS reaches a child
   component's root, and this one is mounted inside the shell. */
.peerpointer { position: fixed; z-index: 60; pointer-events: none;
               /* The arrow's tip is its top-left, so the element sits exactly where the
                  point is rather than being centred on it. */
               transform: translate(-2px, -1px);
               animation: ice-pointer-in .12s ease-out; }
.peerpointer .who { position: absolute; left: 14px; top: 16px; white-space: nowrap;
                    padding: 2px 7px; border-radius: 6px 6px 6px 1px;
                    font-size: 10.5px; line-height: 1.25; font-weight: 600;
                    background: var(--ice-drive-line); color: var(--ice-on-drive);
                    box-shadow: 0 1px 4px rgb(0 0 0 / .25); }
@keyframes ice-pointer-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .peerpointer { animation: none; } }
</style>
