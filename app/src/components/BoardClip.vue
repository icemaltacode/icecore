<script setup>
/* THE PAPERCLIP. What was drawn on a board and kept, offered where the topic is.
 *
 * ONE CONTROL, TWO HOMES. It sits in the exercise footer beside Slides, and in the slides
 * step's header beside the deck's own actions - and it has to be both, because those two
 * cover different rows and neither covers the other. `walk.js` emits a slides row only when
 * the topic has a deck section, so a deckless topic has no header to hang anything on; and
 * the footer's Slides button is deliberately hidden ON a slides step, because offering to
 * open the deck beside a full-pane copy of it reads as a bug. A component rather than the
 * same markup twice, so the two homes cannot come to disagree about what a paperclip is.
 *
 * IT DRAWS NOTHING WHEN THERE IS NOTHING, which is the ordinary case. A disabled paperclip on
 * every topic would be a promise the course does not keep.
 */
import { ref, computed, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import { boardsAt } from '../board.js';

const props = defineProps({
  /** The topic these belong to, e.g. `1.1.3`. */
  topic: String,
  /** `bare` is the icon-only shape the slides header wants; the footer takes a labelled one. */
  bare: Boolean,
});
const emit = defineEmits(['open']);

const list = computed(() => boardsAt(props.topic));
const open = ref(false);

/* One is pressed, several are chosen from. A menu that opens to a single item is a second
 * click for nothing. */
function press() {
  if (list.value.length === 1) return emit('open', list.value[0]);
  open.value = !open.value;
}

const away = e => { if (!e.target.closest?.('.boardclip')) open.value = false; };
/* Added only while a menu is open, and taken away with it - the click-away trap the top bar's
 * two dropdowns already share: a listener that lives longer than the thing it closes will
 * close the gesture that opened it. */
function watchAway(yes) {
  if (yes) addEventListener('click', away);
  else removeEventListener('click', away);
}
onBeforeUnmount(() => watchAway(false));
</script>

<template>
  <span v-if="list.length" class="boardclip">
    <button v-if="bare" class="clipbtn" type="button"
            :title="`${list.length} kept board${list.length === 1 ? '' : 's'} for this topic`"
            :aria-label="`Kept boards (${list.length})`"
            @click="press(); watchAway(open)">
      <Icon name="attach" :size="15" />
      <em v-if="list.length > 1">{{ list.length }}</em>
    </button>
    <button v-else class="btn ghost" type="button" @click="press(); watchAway(open)">
      <Icon name="attach" :size="14" />
      Board<template v-if="list.length > 1">s ({{ list.length }})</template>
    </button>

    <!-- Titles and dates rather than "Board 1, Board 2": the title is typed at the moment
         somebody knew what they had drawn, which is the whole reason it is asked for. -->
    <!-- WHICH WAY IT OPENS IS THE HOME'S QUESTION, not a style. The footer's clip sits at the
         bottom of the pane and the menu belongs above it; the slides header's sits at the very
         TOP, where opening upward puts the menu off the top of the screen - present in the DOM,
         asserted by the test, and invisible. Tied to `bare` because that is exactly the header
         variant; a control that could be anywhere would have to measure. -->
    <ul v-if="open" class="clipmenu" :class="{ down: bare }">
      <li v-for="b in list" :key="b.board">
        <button type="button" @click="open = false; watchAway(false); emit('open', b)">
          <strong>{{ b.title }}</strong>
          <span>{{ b.pages }} page{{ b.pages === 1 ? '' : 's' }}<template
            v-if="b.byName"> · {{ b.byName }}</template></span>
        </button>
      </li>
    </ul>
  </span>
</template>

<style scoped>
/* Unique root class: Vue's scoped CSS reaches a child component's root, and this one holds an
   Icon. Positioned, because the menu hangs off it. */
.boardclip { position: relative; display: inline-flex; align-items: center; }

.clipbtn { display: grid; grid-auto-flow: column; align-items: center; gap: 2px;
  place-items: center; height: 28px; min-width: 28px; padding: 0 4px; border: 0;
  border-radius: 6px; background: none; color: var(--ice-fg-muted); cursor: pointer; }
.clipbtn:hover { color: var(--ice-fg); background: var(--ice-bg-soft); }
.clipbtn:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
.clipbtn em { font-size: 10.5px; font-style: normal; }

.clipmenu { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 40;
  min-width: 220px; margin: 0; padding: 4px; list-style: none;
  background: var(--ice-bg); border: 1px solid var(--ice-border);
  border-radius: 10px; box-shadow: 0 12px 30px rgb(0 0 0 / .2); }
/* Downward, for the clip that lives in a header. See the template. */
.clipmenu.down { bottom: auto; top: calc(100% + 6px); }
.clipmenu button { display: block; width: 100%; padding: 7px 9px; text-align: left;
  border: 0; border-radius: 6px; background: none; color: var(--ice-fg); cursor: pointer;
  font: inherit; }
.clipmenu button:hover { background: var(--ice-bg-soft); }
.clipmenu strong { display: block; font-size: 13px; font-weight: 600; }
.clipmenu span { display: block; font-size: 11.5px; color: var(--ice-fg-muted); }
</style>
