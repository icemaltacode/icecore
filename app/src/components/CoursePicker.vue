<script setup>
/* WHICH COURSES A COHORT TAKES. One component, because there are two places to say it.
 *
 * A cohort is given its courses when it is created and changed on its row afterwards, and
 * those were about to be two different controls saying the same thing - which is how the two
 * end up disagreeing about what a valid choice is exactly when it matters. Enrolment is
 * derived from this list and from nothing else: a course reaches a student through the
 * intake they are in, so this control IS enrolment for everybody in the cohort.
 *
 * NOT CHECKBOXES, AND THE FILTER IS THE REASON. A tick per course is a fine control for the
 * three courses that exist today and an unreadable wall at thirty - and the platform is
 * built so that publishing a course needs no change here, so thirty is a matter of time
 * rather than a hypothetical. What scales is not the layout but the search: the chips say
 * what is chosen without reading the list at all, and the list is something you filter down
 * to rather than scan.
 *
 * TWO STATEMENTS, NOT ONE. The chips are what the cohort takes; the list is what it could.
 * A single list with ticks in it makes the reader assemble the answer from the whole
 * catalogue, and the question anybody actually arrives with is "what is this class on".
 *
 * The list keeps showing what is already taken, marked, rather than removing it: a course
 * that vanished from the list when picked would leave the only way to change your mind in a
 * different control from the one you just used.
 */
import { ref, computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({
  /** The catalogue, as the admin listing carries it: `{ id, title, open, playground }`. */
  courses: Array,
  /** The chosen ids. `v-model`, so the caller owns the set and this only proposes changes. */
  modelValue: Array,
  disabled: Boolean,
});
const emit = defineEmits(['update:modelValue']);

const filter = ref('');
const chosen = computed(() => props.modelValue || []);
const all = computed(() => props.courses || []);
const has = id => chosen.value.includes(id);

const titleOf = id => all.value.find(x => x.id === id)?.title || id;

/* A LITERAL, CASE-INSENSITIVE SUBSTRING, over the title and the id both. The id is what a
 * tutor types into a CSV column, so it is a name they have seen and may well search for; and
 * matching literally rather than as a pattern is the rule the Playground's browser already
 * follows, for the same reason - nobody typing into a filter box means `.` to be a wildcard. */
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return all.value;
  return all.value.filter(c => `${c.title} ${c.id}`.toLowerCase().includes(q));
});

function toggle(id) {
  if (props.disabled) return;
  emit('update:modelValue', has(id) ? chosen.value.filter(x => x !== id) : [...chosen.value, id]);
}

/* Enter takes the only thing left. Filtering to one course and then having to move the mouse
 * to it is the whole gesture done twice; refused when the filter still matches several,
 * because "the first one" is an order nobody chose. */
function takeTheOne() {
  if (shown.value.length !== 1) return;
  toggle(shown.value[0].id);
  filter.value = '';
}
</script>

<template>
  <div class="coursepicker">
    <!-- WHAT IT TAKES, first and readable on its own. Said in words when it takes nothing,
         because an empty strip is indistinguishable from a control that has not loaded - and
         a cohort on no courses is a real and important state, not a blank. -->
    <div class="taken">
      <template v-if="chosen.length">
        <button v-for="id in chosen" :key="id" type="button" class="chip"
                :disabled="disabled" :title="`Remove ${titleOf(id)}`" @click="toggle(id)">
          <span>{{ titleOf(id) }}</span>
          <Icon name="close" :size="12" />
        </button>
      </template>
      <p v-else class="none">Takes no course yet.</p>
    </div>

    <template v-if="all.length">
      <!-- Offered only once the list is long enough to need it. A search box over four rows
           is a control that asks to be used and cannot help. -->
      <input v-if="all.length > 6" v-model="filter" type="search" class="filter"
             placeholder="Filter courses…" :disabled="disabled"
             @keydown.enter.prevent="takeTheOne">
      <ul class="catalogue">
        <li v-for="c in shown" :key="c.id">
          <button type="button" :class="{ on: has(c.id) }" :disabled="disabled"
                  :aria-pressed="has(c.id)" @click="toggle(c.id)">
            <Icon :name="has(c.id) ? 'tick' : 'plus'" :size="13" />
            <span class="name">{{ c.title }}</span>
            <!-- An open course is on everybody's grid anyway, so choosing it changes nothing
                 a student can see. Said rather than hidden: leaving it out would read as the
                 course being missing from the catalogue. -->
            <em v-if="c.open">open to everyone</em>
            <em v-else-if="c.playground">playground</em>
          </button>
        </li>
        <li v-if="!shown.length" class="none">Nothing matches “{{ filter }}”.</li>
      </ul>
    </template>
    <p v-else class="none">No courses are published yet.</p>
  </div>
</template>

<style scoped>
/* THE ROOT CLASS IS UNIQUE ACROSS THE WHOLE APP, not just in here: Vue's scoped CSS reaches
   a child component's root element, so a bare `.picker` would collect whatever the parent
   scopes under that name. Same rule SlidesStep.vue documents at length. */
.coursepicker { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.taken { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px;
        font: inherit; font-size: 12px; line-height: 1;
        padding: 5px 8px 5px 10px; border-radius: 999px; cursor: pointer;
        color: var(--ice-fg); background: var(--ice-primary-soft);
        border: 1px solid transparent; }
.chip:hover:not(:disabled) { border-color: var(--ice-primary); }
.chip:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: 1px; }
.chip:disabled { cursor: default; opacity: .6; }
/* The cross greys until the chip is under the pointer: a row of chips each carrying a live
   delete affordance reads as a row of warnings. */
.chip :deep(.icon) { color: var(--ice-fg-muted); }
.chip:hover :deep(.icon) { color: var(--ice-bad); }

.filter { font: inherit; font-size: 13px; padding: 6px 9px; min-width: 0;
          color: var(--ice-fg); background: var(--ice-bg);
          border: 1px solid var(--ice-border); border-radius: var(--ice-radius); }
.filter:focus { outline: none; border-color: var(--ice-primary); }

/* Scrolls rather than growing, so a catalogue of forty does not push the buttons under it
   off the bottom of a row that is meant to be edited in place. Tall enough for five, which
   is where a list starts reading as a list rather than as three stray buttons. */
.catalogue { list-style: none; margin: 0; padding: 0; max-height: 172px; overflow: auto;
             border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
             background: var(--ice-bg); }
.catalogue > li + li { border-top: 1px solid var(--ice-border); }
.catalogue button { display: flex; align-items: center; gap: 8px; width: 100%;
                    font: inherit; font-size: 13px; text-align: left; cursor: pointer;
                    padding: 7px 10px; background: none; border: 0; color: var(--ice-fg); }
.catalogue button:hover:not(:disabled) { background: var(--ice-bg-soft); }
.catalogue button:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
.catalogue button:disabled { cursor: default; color: var(--ice-fg-muted); }
/* Chosen rows are marked rather than hidden - see the note at the top. The tick carries it,
   in the accent, so the state is legible without relying on the row's background. */
.catalogue button.on :deep(.icon) { color: var(--ice-primary); }
.catalogue button:not(.on) :deep(.icon) { color: var(--ice-fg-muted); }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
em { margin-left: auto; flex: none; font-style: normal; font-size: 11px;
     color: var(--ice-fg-muted); }
.none { margin: 0; padding: 2px 0; font-size: 12px; color: var(--ice-fg-muted); }
.catalogue .none { padding: 8px 10px; }
</style>
