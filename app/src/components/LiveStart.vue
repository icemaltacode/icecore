<script setup>
/* Which course, before a live session starts.
 *
 * A STEP THAT USUALLY DOES NOT APPEAR. Most cohorts are on one course, and asking a
 * question with one possible answer is a click that teaches people to click without
 * reading. So one shared course starts immediately and this never renders; two or more, and
 * it asks.
 *
 * It quotes each course's BOOKMARK - where the last session with this cohort finished - so
 * the thing about to be resumed is visible before it is committed to. That is also the only
 * place the difference between the courses is legible: two titles say nothing about which
 * one Tuesday's class was in the middle of.
 *
 * The shared courses come from `sharedCourses`, which is the same function the Live button
 * used to decide it could be pressed at all. A second reading of "what does this cohort
 * have in common" would eventually disagree with the button that opened this dialog.
 */
import { ref, computed, onMounted } from 'vue';
import { sharedCourses, sessionFor, start, join } from '../delivery.js';
import { live as goLive } from '../route.js';
import Icon from './Icon.vue';

const props = defineProps({
  cohort: Object,
  users: Array,
  courses: Array,
});
const emit = defineEmits(['close']);

const shared = computed(() => sharedCourses(props.cohort.id, props.users));
const titled = computed(() => shared.value.map(id => ({
  id,
  title: (props.courses || []).find(c => c.id === id)?.title || id,
  exercises: (props.courses || []).find(c => c.id === id)?.exercises || 0,
})));

const picked = ref('');
const marks = ref({});
const existing = ref(null);
const loading = ref(true);
const busy = ref(false);
const error = ref('');

const when = iso => (iso ? new Date(iso).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short' }) : '');

onMounted(async () => {
  picked.value = shared.value[0] || '';
  try {
    const r = await sessionFor(props.cohort.id);
    marks.value = r.marks || {};
    existing.value = r.session || null;
    /* Already running - ours, or this dialog would not have opened. Rejoining is not a
     * choice of course: the session already has one, and offering the picker would invite
     * changing it out from under a room that is following along. */
    if (existing.value) {
      join(existing.value);
      goLive(props.cohort.id);
      emit('close');
      return;
    }
    // One course is not a question. Start it and go.
    if (shared.value.length === 1) return begin();
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
});

async function begin() {
  if (!picked.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    await start(props.cohort.id, picked.value);
    goLive(props.cohort.id);
    emit('close');
  } catch (e) {
    // Already the Lambda's sentence, which names whoever holds it.
    error.value = e.message;
    busy.value = false;
  }
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h3>Deliver live to {{ cohort.title }}</h3>

      <p v-if="loading" class="sub">Checking…</p>

      <template v-else>
        <p class="sub">These {{ users.filter(u => !u.admin && (u.cohorts || []).includes(cohort.id)).length }}
          people are all on {{ titled.length }} courses. Pick the one you are teaching now —
          everyone who joins will follow you through it.</p>

        <div class="opts">
          <label v-for="c in titled" :key="c.id" class="opt" :class="{ on: picked === c.id }">
            <input v-model="picked" type="radio" :value="c.id">
            <span class="radio" aria-hidden="true"></span>
            <span class="body">
              <strong>{{ c.title }}</strong>
              <small v-if="c.exercises">{{ c.exercises }} exercises</small>
              <!-- What is being resumed, said before it is resumed. A course nobody has
                   delivered yet says so rather than showing nothing, because a blank line
                   here reads as a bookmark that failed to load. -->
              <span class="resume">
                <Icon name="clock" :size="13" />
                <template v-if="marks[c.id]">Last session ended at
                  {{ marks[c.id].title || marks[c.id].exercise }} — {{ when(marks[c.id].at) }}</template>
                <template v-else>Never delivered live — starts at the beginning</template>
              </span>
            </span>
          </label>
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <div class="foot">
          <p class="note">Nobody is interrupted yet. They see the invitation the moment you
            start.</p>
          <button class="btn" type="button" @click="emit('close')">Cancel</button>
          <button class="btn primary" type="button" :disabled="!picked || busy" @click="begin">
            {{ busy ? 'Starting…' : 'Start live delivery' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; z-index: 60; background: var(--ice-scrim);
         display: flex; align-items: center; justify-content: center; padding: 20px; }
.dialog { width: min(560px, 100%); background: var(--ice-bg); border: 1px solid var(--ice-border);
          border-radius: var(--ice-radius); box-shadow: 0 24px 60px rgb(0 0 0 / .28);
          padding: 22px 24px 18px; max-height: 100%; overflow: auto; }
h3 { margin: 0; font-size: 18px; font-weight: 500; }
.sub { margin: 7px 0 18px; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.6; }
.err { margin: 14px 0 0; font-size: 13px; color: var(--ice-bad); line-height: 1.5; }

.opts { display: flex; flex-direction: column; gap: 10px; }
.opt { display: flex; gap: 12px; align-items: flex-start; padding: 13px 14px;
       border-radius: var(--ice-radius); border: 1px solid var(--ice-border);
       background: var(--ice-bg-soft); cursor: pointer; }
.opt.on { border-color: var(--ice-primary); background: var(--ice-bg);
          box-shadow: 0 0 0 3px var(--ice-primary-soft); }
/* The real input is what the keyboard and a screen reader use; the circle beside it is
   what everyone else sees. Hidden with a clip rather than display:none, which would take
   it out of the tab order along with the accessibility. */
.opt input { position: absolute; width: 1px; height: 1px; overflow: hidden;
             clip-path: inset(50%); }
.radio { flex: none; width: 16px; height: 16px; border-radius: 50%; margin-top: 3px;
         border: 1.5px solid #cbd5e1; background: var(--ice-bg); }
.opt.on .radio { border: 5px solid var(--ice-primary); }
.opt input:focus-visible + .radio { outline: 2px solid var(--ice-primary); outline-offset: 2px; }
.body { flex: 1; min-width: 0; }
.body strong { display: block; font-size: 14px; font-weight: 500; }
.body small { display: block; font-size: 12px; color: var(--ice-fg-muted); margin-top: 3px; }
.resume { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
          font-size: 12px; color: var(--ice-primary-strong);
          background: var(--ice-primary-soft); border-radius: 6px; padding: 4px 8px; }

.foot { display: flex; align-items: center; gap: 10px; justify-content: flex-end;
        margin-top: 20px; }
.note { margin: 0 auto 0 0; font-size: 12px; color: var(--ice-fg-muted); max-width: 300px;
        line-height: 1.45; }
</style>
