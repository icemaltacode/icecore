<script setup>
/* The conversation, docked in the participants panel or floating over the player.
 *
 * ONE COMPONENT IN TWO PLACES, not two. Docked and undocked are the same log, the same
 * composer and the same rules; written twice they would drift, and the drift would be in
 * the half nobody is looking at. `popped` changes where it is drawn and almost nothing
 * about what is drawn - a header that can be dragged, and a shadow.
 *
 * A MESSAGE CARRIES WHERE IT WAS SENT FROM, and that is the part worth having. A student
 * asking "why does this return nothing?" is asking about a particular exercise, and without
 * the origin a tutor has to ask which one before they can answer. Shown only when it
 * differs from where the reader already is: an origin repeated under every message is a
 * column of noise that makes the one that matters harder to see.
 *
 * IT IS A BUTTON, so the answer is to go there. For a following student that stops the
 * follow, which is correct and needs no special case - it goes through the same navigation
 * every other move does, and the band says so and offers the way back.
 *
 * Enter sends and Shift-Enter breaks the line, which is what every chat does; a Send button
 * is there as well because on a touch keyboard Enter is Return.
 */
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue';
import { chat, say, mine, reading, pop, LIMIT } from '../chat.js';
import Icon from './Icon.vue';

const props = defineProps({
  /** Floating over the player rather than docked in the panel. */
  popped: Boolean,
  /** Where the reader is, so an origin is only drawn when it says something. */
  hereAt: [String, Number],
});
const emit = defineEmits(['goto']);

const draft = ref('');
const log = ref(null);

/* Anything showing the log has read it. The count is in chat.js because the badge on the
 * collapsed rail is drawn by something that is not this component. */
onMounted(() => reading(true));
onUnmounted(() => reading(false));

/* Stick to the bottom, which is where a conversation is. Only when already there: a tutor
 * who has scrolled up to re-read a question should not be yanked back down by the next
 * message, which is exactly when they are least able to afford it. */
const NEAR = 60;
let stick = true;
const atBottom = () => {
  const el = log.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
};
const onScroll = () => { stick = atBottom(); };
watch(() => chat.messages.length, async () => {
  if (!stick) return;
  await nextTick();
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}, { immediate: true });

const same = (a, b) => a != null && b != null && String(a) === String(b);
/** The origin, when there is one and it is not simply here. */
const from = m => (m.where?.exercise != null && !same(m.where.exercise, props.hereAt)
  ? m.where : null);

const clock = at => {
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

function submit() {
  if (!say(draft.value)) return;
  draft.value = '';
  stick = true;
}

/* ---- dragging the floating one -------------------------------------------
 *
 * Held as offsets from the bottom-right corner rather than as a position, so the window
 * does not have to know its own size and a browser resized smaller cannot leave it off the
 * far edge. Pointer events rather than mouse ones: the same three handlers then cover a
 * trackpad, a touchscreen and a pen, which `mousedown` does not.
 */
const SPOT_KEY = 'ice-live-chat-spot';
const spot = ref({ right: 24, bottom: 24 });
try {
  const saved = JSON.parse(localStorage.getItem(SPOT_KEY) || 'null');
  if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) spot.value = saved;
} catch { /* a browser that will not give it back is a browser that starts in the corner */ }

const style = computed(() => (props.popped
  ? { right: `${spot.value.right}px`, bottom: `${spot.value.bottom}px` }
  : null));

let dragging = null;
function grab(e) {
  if (!props.popped || e.target.closest('button')) return;
  dragging = { x: e.clientX, y: e.clientY, ...spot.value };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function move(e) {
  if (!dragging) return;
  // Clamped so a header always stays reachable: a window dragged off screen cannot be
  // dragged back, and its only other control is inside it.
  spot.value = {
    right: Math.min(Math.max(dragging.right - (e.clientX - dragging.x), 0), innerWidth - 120),
    bottom: Math.min(Math.max(dragging.bottom - (e.clientY - dragging.y), 0), innerHeight - 60),
  };
}
function drop() {
  if (!dragging) return;
  dragging = null;
  try { localStorage.setItem(SPOT_KEY, JSON.stringify(spot.value)); } catch { /* fine */ }
}
</script>

<template>
  <section class="livechat" :class="{ float: popped }" :style="style">
    <header :class="{ grab: popped }"
            @pointerdown="grab" @pointermove="move" @pointerup="drop" @pointercancel="drop">
      <Icon name="chat" :size="15" />
      <h4>Chat</h4>
      <button class="shut" type="button"
              :title="popped ? 'Dock the chat in the panel' : 'Pop the chat out'"
              @click="pop()">
        <Icon :name="popped ? 'dock' : 'tab'" :size="14" />
      </button>
    </header>

    <div ref="log" class="log" @scroll.passive="onScroll">
      <p v-if="!chat.messages.length" class="none">Nothing said yet. Anyone in the session
        can write here, and it is gone when the session ends.</p>

      <div v-for="m in chat.messages" :key="m.id"
           class="msg" :class="{ own: mine(m), tutor: m.role === 'tutor' }">
        <span class="avatar" :class="{ lead: m.role === 'tutor' }">{{ initials(m.from) }}</span>
        <div class="body">
          <span class="meta">
            <strong>{{ mine(m) ? 'You' : m.from || 'Somebody' }}</strong>
            <em v-if="m.role === 'tutor'">Educator</em>
            <time>{{ clock(m.at) }}</time>
          </span>
          <p class="text">{{ m.text }}</p>
          <button v-if="from(m)" class="where" type="button"
                  :title="`Go to ${from(m).title || from(m).exercise}`"
                  @click="emit('goto', from(m).exercise)">
            <Icon name="pin" :size="11" />{{ from(m).title || from(m).exercise }}
          </button>
        </div>
      </div>
    </div>

    <form class="compose" @submit.prevent="submit">
      <textarea v-model="draft" rows="1" :maxlength="LIMIT"
                placeholder="Say something to the session"
                @keydown.enter.exact.prevent="submit"></textarea>
      <button class="btn primary" type="submit" :disabled="!draft.trim()">Send</button>
    </form>
  </section>
</template>

<style scoped>
/* `livechat` is unique across the app on purpose - Vue's scoped CSS reaches a child
   component's root element, so a bare `.chat` here would collect whatever the panel or the
   shell happens to say about one. Same failure LivePanel.vue documents at length. */
.livechat { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0;
            background: var(--ice-bg-soft); }

/* Floating: over the player, not in the grid. Resizable because the useful size of a chat
   window is a matter of what the lesson is doing, and one line of CSS beats two buttons. */
.livechat.float { position: fixed; z-index: 60; width: 340px; height: 420px;
                  min-width: 260px; min-height: 220px; max-width: 90vw; max-height: 85vh;
                  resize: both; overflow: hidden;
                  background: var(--ice-bg); border: 1px solid var(--ice-border);
                  border-radius: 12px; box-shadow: 0 16px 44px rgb(0 0 0 / .22); }

header { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
         border-bottom: 1px solid var(--ice-border); color: var(--ice-fg-muted); }
.livechat:not(.float) header { border-top: 1px solid var(--ice-border); }
header.grab { cursor: grab; touch-action: none; user-select: none; }
header.grab:active { cursor: grabbing; }
h4 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; color: var(--ice-fg); }
.shut { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
        background: none; border: 1px solid transparent; color: var(--ice-fg-muted);
        cursor: pointer; }
.shut:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }

.log { overflow: auto; padding: 10px 10px 4px; display: flex; flex-direction: column; gap: 10px; }
.none { margin: 6px 4px; font-size: 12px; color: var(--ice-fg-muted); line-height: 1.5; }

.msg { display: flex; gap: 8px; align-items: flex-start; }
.avatar { flex: none; width: 22px; height: 22px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; background: var(--ice-primary-soft);
          color: var(--ice-primary-strong); font-size: 9px; font-weight: 600; line-height: 1; }
.avatar.lead { background: var(--ice-primary); color: var(--ice-on-primary); }
.body { min-width: 0; flex: 1; }
.meta { display: flex; align-items: baseline; gap: 6px; font-size: 11px;
        color: var(--ice-fg-muted); }
.meta strong { font-size: 12px; font-weight: 600; color: var(--ice-fg); }
.meta em { font-style: normal; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
           font-family: var(--ice-font-mono); color: var(--ice-primary-strong); }
.meta time { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 10.5px; }
.text { margin: 2px 0 0; font-size: 13px; line-height: 1.45; white-space: pre-wrap;
        overflow-wrap: anywhere; }
/* Our own are tinted rather than aligned to the other edge: a class of twelve reads as one
   column of who-said-what, and an alternating layout halves the width of every message to
   say something the name already says. */
.msg.own .text { color: var(--ice-fg); }
.msg.own .body { background: var(--ice-primary-soft); border-radius: 8px; padding: 4px 8px 6px;
                 margin: -2px -2px 0; }

.where { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; padding: 2px 7px;
         border-radius: 999px; font: inherit; font-size: 11px; cursor: pointer;
         background: var(--ice-raise); border: 1px solid var(--ice-border);
         color: var(--ice-fg-muted); max-width: 100%; overflow: hidden;
         text-overflow: ellipsis; white-space: nowrap; }
.where:hover { color: var(--ice-fg); border-color: var(--ice-primary); }

.compose { display: flex; gap: 6px; align-items: flex-end; padding: 8px 10px 10px;
           border-top: 1px solid var(--ice-border); }
textarea { flex: 1; min-width: 0; font: inherit; font-size: 13px; line-height: 1.4;
           padding: 7px 9px; resize: none; field-sizing: content; max-height: 120px;
           background: var(--ice-bg); color: var(--ice-fg);
           border: 1px solid var(--ice-border); border-radius: 8px; }
textarea:focus { outline: none; border-color: var(--ice-primary); }
.compose .btn { flex: none; }
</style>
