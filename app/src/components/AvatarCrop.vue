<script setup>
/* Choose the square. Drag to move, slider or wheel to zoom, and that is the whole of it.
 *
 * NOT A LIBRARY, and the reason is that the general problem is not the one here. A cropper
 * package earns its size on arbitrary aspect ratios, rotation, output sizing and a container
 * that resizes; this produces one fixed square at one fixed size, which leaves pan, zoom and
 * a clamp.
 *
 * THE STATE IS A SQUARE IN THE IMAGE, not a set of CSS offsets. `zoom` and `x`/`y` are what
 * the pointer moves, but everything derived - what is drawn, what is clamped, what is
 * exported - goes through the same conversion into the image's own pixels. Keeping the
 * answer in display units instead is how a cropper ends up producing something a few pixels
 * off from what it showed.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  /** A decoded HTMLImageElement - see avatar.js. */
  image: { type: Object, required: true },
  busy: Boolean,
});
const emit = defineEmits(['use', 'cancel']);

/* The viewport is square and fixed. A responsive one would mean recomputing the clamp on
 * every resize, for a dialog nobody resizes. */
const VIEW = 300;
const MAX_ZOOM = 5;

/* Zoom 1 is COVER, not natural size: the smallest scale at which the image fills the
 * viewport, so there is never a gap at any zoom and the clamp below is the only rule
 * needed. */
const base = computed(() =>
  VIEW / Math.min(props.image.naturalWidth, props.image.naturalHeight));

const zoom = ref(1);
const x = ref(0);   // the image's left edge, in viewport pixels
const y = ref(0);

const shown = computed(() => ({
  w: props.image.naturalWidth * base.value * zoom.value,
  h: props.image.naturalHeight * base.value * zoom.value,
}));

/* The image must always cover the viewport, so its left edge is at most 0 and its right edge
 * at least VIEW. Applied after every move AND after every zoom - zooming out from a corner
 * is the case that exposes a gap if only dragging is clamped. */
function clamp() {
  const { w, h } = shown.value;
  x.value = Math.min(0, Math.max(VIEW - w, x.value));
  y.value = Math.min(0, Math.max(VIEW - h, y.value));
}

function centre() {
  x.value = (VIEW - shown.value.w) / 2;
  y.value = (VIEW - shown.value.h) / 2;
}
onMounted(centre);

/* Zoom about the CENTRE of the viewport rather than about the image's origin, or the picture
 * swims off sideways as it grows and the thing being framed is the first to leave. */
function setZoom(next) {
  const was = zoom.value;
  zoom.value = Math.min(MAX_ZOOM, Math.max(1, next));
  const k = zoom.value / was;
  x.value = VIEW / 2 - (VIEW / 2 - x.value) * k;
  y.value = VIEW / 2 - (VIEW / 2 - y.value) * k;
  clamp();
}

let dragging = null;
function down(e) {
  dragging = { px: e.clientX, py: e.clientY };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function move(e) {
  if (!dragging) return;
  x.value += e.clientX - dragging.px;
  y.value += e.clientY - dragging.py;
  dragging = { px: e.clientX, py: e.clientY };
  clamp();
}
const up = () => { dragging = null; };

/* Passive: false, because the default action of a wheel over a dialog is to scroll the page
 * behind it, and preventDefault is not available to a passive listener - which is what Vue's
 * @wheel gives you by default in some setups. Bound by hand for that reason. */
const frame = ref(null);
const wheel = e => { e.preventDefault(); setZoom(zoom.value * (e.deltaY > 0 ? 0.94 : 1.06)); };
onMounted(() => frame.value?.addEventListener('wheel', wheel, { passive: false }));
onBeforeUnmount(() => frame.value?.removeEventListener('wheel', wheel));

/** The chosen square, in the image's own pixels - the only thing this component produces. */
function use() {
  const scale = base.value * zoom.value;
  emit('use', { sx: -x.value / scale, sy: -y.value / scale, size: VIEW / scale });
}
</script>

<template>
  <div class="scrim" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-label="Choose your picture" @keydown.esc="emit('cancel')">
      <h3>Choose your picture</h3>

      <!-- The mask is a ring of background colour with a hole in it, drawn OVER the image:
           it shows what is being kept without hiding what is being left out, which is what a
           student is actually deciding. -->
      <div ref="frame" class="frame" @pointerdown="down" @pointermove="move"
           @pointerup="up" @pointercancel="up">
        <img :src="image.src" :width="shown.w" :height="shown.h"
             :style="{ left: x + 'px', top: y + 'px' }" alt="" draggable="false">
        <div class="mask"></div>
      </div>

      <label class="zoom">
        <input type="range" min="1" :max="MAX_ZOOM" step="0.01"
               :value="zoom" @input="setZoom(Number($event.target.value))">
      </label>

      <div class="acts">
        <button class="btn primary" :disabled="busy" @click="use">
          {{ busy ? 'Saving…' : 'Use this picture' }}
        </button>
        <button class="btn ghost" :disabled="busy" @click="emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
         background: rgb(0 0 0 / .5); padding: 20px; }
.dialog { background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
          border-radius: var(--ice-radius); padding: 22px; max-width: 100%; }
h3 { margin: 0 0 16px; font-size: 16px; }

/* touch-action: none, or a drag on a phone scrolls the page instead of moving the picture -
   pointer events fire either way, so without this it does both. */
.frame { position: relative; width: 300px; height: 300px; max-width: 100%;
         overflow: hidden; border-radius: 12px; background: var(--ice-bg);
         cursor: grab; touch-action: none; user-select: none; }
.frame:active { cursor: grabbing; }
.frame img { position: absolute; max-width: none; pointer-events: none; }
/* An enormous ring rather than a border: it has to cover the whole frame however big that
   is, and a box-shadow spread is the one way to get a hole in a solid colour without a
   second element or an SVG. */
.mask { position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
        box-shadow: 0 0 0 9999px rgb(0 0 0 / .55);
        outline: 1px solid rgb(255 255 255 / .35); outline-offset: -1px; }

.zoom { display: block; margin: 16px 0 0; }
.zoom input { width: 100%; accent-color: var(--ice-primary); }

.acts { display: flex; gap: 8px; margin-top: 18px; }
</style>
