<script setup>
/* CARRYING ON FROM A BOARD YOU ALREADY DREW.
 *
 * ONE CLASS'S BOARDS, and the class is the one being taught right now. A board belongs to the
 * intake it was drawn for, so this list does not span cohorts - see WHITEBOARD.md. Reopening
 * last term's diagram for this term's class is a real wish and it is the wrong one: it would
 * make one class's lesson into material handed to another, arriving through a convenience
 * rather than through a screen anybody designed.
 *
 * IT WARNS ABOUT WHAT IS ON THE BOARD NOW, and only when there is something to lose. Opening
 * replaces every page, and a board that has never been kept has no copy anywhere - so this is
 * the one moment where a click can destroy something that exists nowhere else.
 */
import { ref, computed, onMounted } from 'vue';
import Icon from './Icon.vue';
import { keptForRoom, dropBoard } from '../board.js';

const props = defineProps({
  /** The open course, which is the scope of the list. */
  course: String,
  cohortTitle: String,
  /** True when the board on screen has pages on it and has never been kept. */
  unsaved: Boolean,
  /** The kept board currently being carried on from, if any. Marked rather than hidden. */
  currentId: String,
});
const emit = defineEmits(['pick', 'close']);

const boards = ref([]);
const error = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    const answer = await keptForRoom(props.course);
    /* Newest first. The board somebody wants to carry on from is almost always the last one
     * they drew, and the id is base-36 milliseconds so the server's order is oldest first. */
    boards.value = [...(answer?.boards || [])].reverse();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

/* WHICH ROW IS ASKING TO BE DELETED, by id, or ''. Inline rather than a second dialog: this
 * one is already a list of things to choose between, and a modal over a modal to remove one
 * of them is a stack nobody can read. Same shape CohortList uses for the same reason. */
const confirming = ref('');
const removing = ref('');

async function remove(b) {
  removing.value = b.board;
  try {
    await dropBoard(b);
    boards.value = boards.value.filter(x => x.board !== b.board);
    confirming.value = '';
  } catch (e) {
    error.value = e.message;
  } finally {
    removing.value = '';
  }
}

const when = at => {
  const d = new Date(at || '');
  return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const empty = computed(() => !loading.value && !error.value && !boards.value.length);
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="open-h">
      <h3 id="open-h">Carry on from a board</h3>

      <p v-if="unsaved" class="warn" role="alert">
        What is on the board now has not been kept, and opening one of these replaces it.
      </p>

      <p v-if="loading" class="quiet">Looking…</p>
      <p v-else-if="error" class="bad" role="alert">{{ error }}</p>
      <!-- The empty case says whose list it is, because "nothing here" and "nothing here for
           THIS class" are different facts and only the second one is true. -->
      <p v-else-if="empty" class="quiet">
        Nothing has been kept for
        <strong v-if="cohortTitle">{{ cohortTitle }}</strong><template v-else>this class</template>
        on this course yet.
      </p>

      <ul v-else class="list">
        <li v-for="b in boards" :key="b.board">
          <template v-if="confirming === b.board">
            <!-- Said in full. Nothing about a board is recoverable and nothing else in the
                 product keeps a copy of it, so this is not a tidy-up, it is the only copy. -->
            <p class="warn">
              Delete <strong>{{ b.title }}</strong>? Its {{ b.pages }}
              page{{ b.pages === 1 ? '' : 's' }} go for good, and your class loses it from
              {{ b.topic }}.<template v-if="b.board === currentId"> What is on screen stays,
              and Keep would file it as a new board.</template>
            </p>
            <div class="rowacts">
              <button class="btn danger" type="button" :disabled="removing === b.board"
                      @click="remove(b)">{{ removing === b.board ? 'Deleting…' : 'Delete' }}</button>
              <button class="link" type="button" @click="confirming = ''">Cancel</button>
            </div>
          </template>
          <div v-else class="row">
            <button class="pick" type="button" @click="emit('pick', b)">
              <Icon name="attach" :size="14" />
              <span class="what">
                <strong>{{ b.title }}<!-- MARKED, NOT HIDDEN. This is also the only place the
                  board on screen can be deleted, so removing it from the list would mean the
                  one board somebody is looking at is the one they cannot get rid of.
                  --><em v-if="b.board === currentId" class="now">open now</em></strong>
                <em>{{ b.topic }} · {{ b.pages }} page{{ b.pages === 1 ? '' : 's' }}<template
                  v-if="when(b.at)"> · {{ when(b.at) }}</template></em>
              </span>
            </button>
            <button class="drop" type="button" :title="`Delete ${b.title}`"
                    :aria-label="`Delete ${b.title}`" @click="confirming = b.board">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </li>
      </ul>

      <div class="acts">
        <button class="btn" type="button" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Above the board at 45, like the other dialog that opens over it. */
.scrim { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
         background: var(--ice-scrim); padding: 20px; }
.sheet { width: min(460px, 100%); max-height: min(70vh, 560px); overflow: auto;
         background: var(--ice-bg); border-radius: 14px; border: 1px solid var(--ice-border);
         padding: 22px; box-shadow: 0 20px 60px rgb(0 0 0 / .3); }
h3 { margin: 0 0 14px; font-size: 17px; }
.quiet { margin: 0; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.6; }
.bad { margin: 0; font-size: 13px; color: var(--ice-bad); }
.warn { margin: 0 0 12px; padding: 8px 10px; font-size: 12.5px; line-height: 1.5;
        color: var(--ice-fg); background: var(--ice-bad-fill);
        border: 1px solid var(--ice-bad-line); border-radius: 8px; }

.list { margin: 0; padding: 0; list-style: none; }
.row { display: flex; align-items: center; }
.list .pick { display: flex; align-items: center; gap: 10px; flex: 1 1 auto; min-width: 0;
              padding: 9px 10px; text-align: left; border: 0; border-radius: 8px;
              background: none; color: var(--ice-fg); cursor: pointer; font: inherit; }
.list .pick:hover { background: var(--ice-bg-soft); }
/* ALWAYS VISIBLE. This was drawn at `opacity: 0` until the row was hovered, on the reasoning
   that a delete beside every entry at full contrast reads as the thing the list is for - which
   is true of the CONTRAST and not of the existence. Hidden, it was simply not found, and on a
   touchscreen there is no hover to find it with. Muted colour does the job the hiding was
   meant to do. */
.list .drop { flex: none; display: grid; place-items: center; width: 26px; height: 26px;
              padding: 0; border: 0; border-radius: 6px; background: none;
              color: var(--ice-fg-muted); cursor: pointer; }
.list .drop:hover { color: var(--ice-bad); background: var(--ice-bad-fill); }
.list .drop:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
.rowacts { display: flex; align-items: center; gap: 8px; padding: 0 10px 8px; }
.list .what { display: block; min-width: 0; }
.list strong { display: block; font-size: 13.5px; font-weight: 600; }
.list .now { margin-left: 6px; padding: 1px 6px; font-size: 10.5px; font-style: normal;
             font-weight: 500; color: var(--ice-primary);
             background: var(--ice-primary-soft); border-radius: 999px; }
.list em { display: block; font-size: 11.5px; font-style: normal; color: var(--ice-fg-muted); }

.acts { display: flex; justify-content: flex-end; margin-top: 18px; }
</style>
