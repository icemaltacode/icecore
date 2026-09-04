<script setup>
/* KEEPING A BOARD, which is the moment it stops being a lesson and becomes a document.
 *
 * IT ASKS FOR A TITLE, and that is the whole reason this is a dialog rather than a button
 * that just saves. A list of boards a month later reads as "Whiteboard, Whiteboard,
 * Whiteboard" unless somebody names them at the one moment they know what they drew - and
 * that moment is now.
 *
 * IT SAYS WHERE IT LANDS AND WHO GETS IT, because both are decisions the educator did not
 * make and would otherwise have to guess at: the board is anchored to the topic they are on,
 * and it goes to this class and no other. A board is the record of one class's lesson, never
 * course material - see WHITEBOARD.md - and the copy is where that becomes visible rather
 * than being a rule only the keys know about.
 */
import { ref, onMounted, computed } from 'vue';

const props = defineProps({
  /** How many pages are about to be kept. */
  pages: { type: Number, default: 1 },
  /** Where it lands: the topic's own label, and its number for the ones who think in those. */
  topicTitle: String,
  topic: String,
  /** Who gets it. */
  cohortTitle: String,
  /** Set while the write is in flight, and the message if it came back refused. */
  busy: Boolean,
  error: String,
});
const emit = defineEmits(['save', 'close']);

const title = ref('');
const field = ref(null);
/* Prefilled with the topic, because that is the honest default and it is also what somebody
 * would type. Selected rather than merely present, so the first keystroke replaces it -
 * a prefilled field you have to clear is slower than an empty one. */
onMounted(() => {
  title.value = props.topicTitle || 'Whiteboard';
  field.value?.select?.();
});

const count = computed(() => `${props.pages} page${props.pages === 1 ? '' : 's'}`);
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="save-h">
      <h3 id="save-h">Keep this board</h3>

      <label class="field">
        <span>What is it called?</span>
        <input ref="field" v-model="title" maxlength="120" type="text"
               placeholder="Whiteboard" @keyup.enter="emit('save', title)" />
      </label>

      <ul class="facts">
        <li>{{ count }}, kept as they are now.</li>
        <li v-if="topicTitle">Your class will find it on <strong>{{ topicTitle }}</strong><template
          v-if="topic"> ({{ topic }})</template>.</li>
        <li v-if="cohortTitle">Only <strong>{{ cohortTitle }}</strong> gets it — a board is the
          record of this lesson, not part of the course.</li>
      </ul>

      <p v-if="error" class="bad" role="alert">{{ error }}</p>

      <div class="acts">
        <button class="btn" type="button" :disabled="busy" @click="emit('close')">Cancel</button>
        <button class="btn primary" type="button" :disabled="busy"
                @click="emit('save', title)">{{ busy ? 'Keeping…' : 'Keep it' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Above the board itself, which sits at 45 - a dialog that opened behind it could not be
   answered. Same 80 the other two full-stop dialogs use. */
.scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
         background: var(--ice-scrim); padding: 20px; }
.sheet { width: min(440px, 100%); background: var(--ice-bg); border-radius: 14px;
         border: 1px solid var(--ice-border); padding: 22px;
         box-shadow: 0 20px 60px rgb(0 0 0 / .3); }
h3 { margin: 0 0 14px; font-size: 17px; }
.field { display: block; margin: 0 0 14px; }
.field span { display: block; margin-bottom: 6px; font-size: 12.5px; color: var(--ice-fg-muted); }
.field input { width: 100%; padding: 8px 10px; font: inherit; font-size: 14px;
               color: var(--ice-fg); background: var(--ice-bg-soft);
               border: 1px solid var(--ice-border); border-radius: 8px; }
.field input:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -1px; }
.facts { margin: 0; padding: 0 0 0 18px; font-size: 13px; line-height: 1.7;
         color: var(--ice-fg-muted); }
.bad { margin: 12px 0 0; font-size: 13px; color: var(--ice-bad); }
.acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>
