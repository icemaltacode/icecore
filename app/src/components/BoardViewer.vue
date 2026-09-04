<script setup>
/* A KEPT BOARD, opened later. The other end of the paperclip.
 *
 * NOT THE WHITEBOARD COMPONENT WITH A FLAG. That one is a live surface: it holds a drauu
 * instance, a toolbar, a session's state and a rule about who may draw. This is a picture
 * with a pager. Folding them together would mean every future change to the live board
 * asking whether it also applies to a drawing from three weeks ago, and the answer would
 * usually be no.
 *
 * SAME STAGE, though, and that is the whole reason a saved board is worth anything: the
 * drawing was stored in board units, so it renders here exactly as it did in the room - on a
 * different screen, in a different theme, months later.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import { STAGE, openSaved } from '../board.js';
import { clean } from '../svgclean.js';

const props = defineProps({
  /** The listing entry: cohort, topic, board, title, byName, at, pages. */
  entry: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const viewBox = `0 0 ${STAGE.w} ${STAGE.h}`;
const pages = ref([]);
const page = ref(0);
const error = ref('');
const loading = ref(true);

/* Filtered on the way onto the screen. It was filtered when it arrived off the socket too,
 * but that was a different browser's decision and this one is where the DOM is built - and a
 * board saved before the filter existed would otherwise be the exception nobody thought of. */
const shown = computed(() => clean(pages.value[page.value] || ''));

const when = computed(() => {
  const d = new Date(props.entry?.at || '');
  return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined,
    { year: 'numeric', month: 'long', day: 'numeric' });
});

onMounted(async () => {
  try {
    const answer = await openSaved(props.entry);
    pages.value = answer?.pages || [];
    /* A board whose header survived and whose pages did not is the one shape a half-written
     * save could leave. Said, rather than drawn as a blank page somebody thinks is the
     * drawing. */
    if (!pages.value.length) error.value = 'This board has no pages left in it.';
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

const go = n => { page.value = Math.min(pages.value.length - 1, Math.max(0, page.value + n)); };

function onKey(e) {
  if (e.key === 'Escape') { emit('close'); return; }
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft') go(-1);
}
onMounted(() => addEventListener('keydown', onKey));
onBeforeUnmount(() => removeEventListener('keydown', onKey));
watch(() => props.entry, () => { page.value = 0; });
</script>

<template>
  <div class="boardview" @click.self="emit('close')">
    <header class="bvhead">
      <Icon name="attach" :size="15" />
      <strong>{{ entry.title }}</strong>
      <span class="bvby">
        <template v-if="entry.byName">{{ entry.byName }}</template>
        <template v-if="entry.byName && when"> · </template>{{ when }}
      </span>
      <span class="bvspace"></span>
      <button class="btn ghost" type="button" @click="emit('close')">Close</button>
    </header>

    <div class="bvstage">
      <p v-if="loading" class="bvsay">Fetching it…</p>
      <p v-else-if="error" class="bvsay bad" role="alert">{{ error }}</p>
      <svg v-else class="bvsurface" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet"
           v-html="shown"></svg>
    </div>

    <!-- Only when there is more than one. A pager over a single page is a control that says
         there is somewhere else to go and then refuses. -->
    <footer v-if="pages.length > 1" class="bvfoot">
      <button class="btn ghost" type="button" :disabled="page <= 0" @click="go(-1)">Previous</button>
      <span class="muted">{{ page + 1 }} / {{ pages.length }}</span>
      <button class="btn ghost" type="button" :disabled="page >= pages.length - 1"
              @click="go(1)">Next</button>
    </footer>
  </div>
</template>

<style scoped>
/* Unique root class - Vue's scoped CSS reaches a child component's root, and this one hosts
   an Icon and three buttons. Above the live board, because a saved one is opened from a
   screen that is not in a lesson at all and would otherwise have nothing beneath it. */
.boardview { position: fixed; inset: 0; z-index: 60; display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto; background: var(--ice-scrim); }

.bvhead { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  font-size: 13.5px; color: var(--ice-fg); background: var(--ice-bg);
  border-bottom: 1px solid var(--ice-border); }
.bvby { font-size: 12.5px; color: var(--ice-fg-muted); }
.bvspace { flex: 1 1 auto; }

.bvstage { min-height: 0; display: grid; place-items: center; padding: 16px; }
/* The literal white plate again, and for the same reason: the ink was chosen for a white
   board and stored as itself, so the board has to be white wherever it is opened. */
.bvsurface { width: 100%; height: 100%; max-width: calc((100vh - 160px) * 16 / 9);
  max-height: calc(100vw * 9 / 16); aspect-ratio: 16 / 9; background: #fff;
  border-radius: var(--ice-radius); box-shadow: 0 10px 40px rgb(0 0 0 / 0.35); }
.bvsay { font-size: 13.5px; color: var(--ice-bg); }
.bvsay.bad { color: var(--ice-bad); }

.bvfoot { display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 8px; background: var(--ice-bg); border-top: 1px solid var(--ice-border); }
</style>
