<script setup>
/* Managing the cohorts themselves: rename one, finish one, remove one.
 *
 * A SECTION rather than a dialog, which is what it started as. The difference is not
 * cosmetic: a modal is something you open, do one thing in and dismiss, and this is a place
 * you can be - `#/admin/cohorts` addresses it, the nav shows you are in it, and it will
 * carry a cohort's own page when there is one. A dialog cannot hold that.
 *
 * Deliberately a small screen with no way to create anything. A cohort is named at the
 * moment somebody is put in it - in UserDialog, or in the import - because that is when a
 * tutor knows what to call it, and a create form here would be a second place to invent one
 * with nobody in it. What is left is the three things you can only want later.
 *
 * ARCHIVING IS THE ORDINARY END OF AN INTAKE, not deleting. It keeps the grouping and its
 * statistics and takes it out of the pickers; a training company accumulates classes, and
 * a picker holding forty dead ones is a picker nobody reads.
 */
import { ref, computed } from 'vue';
import { api } from '../auth.js';

const props = defineProps({
  cohorts: Array,
  /** Every user, so a member count is a tally of what the listing already carried. */
  users: Array,
});
const emit = defineEmits(['done']);

const busy = ref('');
const error = ref('');
const renaming = ref('');
const title = ref('');
const confirming = ref('');

const counts = computed(() => {
  const n = {};
  for (const u of props.users || []) for (const c of u.cohorts || []) n[c] = (n[c] || 0) + 1;
  return n;
});

const listed = computed(() => [...(props.cohorts || [])]
  .sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.title.localeCompare(b.title)));

async function run(label, fn) {
  error.value = ''; busy.value = label;
  try { emit('done', await fn()); }
  catch (e) { error.value = e.message; }
  finally { busy.value = ''; }
}

const startRename = c => { renaming.value = c.id; title.value = c.title; };

const rename = c => run('save', async () => {
  await api('admin/cohorts', { method: 'PUT', body: { id: c.id, title: title.value.trim() } });
  renaming.value = '';
  return `Renamed to ${title.value.trim()}.`;
});

const setArchived = (c, archived) => run(c.id, async () => {
  await api('admin/cohorts', { method: 'PUT', body: { id: c.id, archived } });
  return archived ? `${c.title} archived.` : `${c.title} is active again.`;
});

const destroy = c => run('delete', async () => {
  const r = await api(`admin/cohorts?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
  confirming.value = '';
  return `${c.title} deleted. ${r.removed} ${r.removed === 1 ? 'person is' : 'people are'} no longer grouped - nobody was removed from anything else.`;
});
</script>

<template>
  <section class="cohorts">
    <p class="lead">A cohort is a class or an intake — a group of people, not a course.
      New ones are named when you add or import somebody, which is when you know what to
      call them.</p>

    <p v-if="error" class="err">{{ error }}</p>

      <ul class="list">
        <li v-for="c in listed" :key="c.id" :class="{ off: c.archived }">
          <template v-if="renaming === c.id">
            <input v-model="title" type="text" @keydown.enter.prevent="rename(c)">
            <button class="btn" type="button" :disabled="!title.trim() || !!busy" @click="rename(c)">Save</button>
            <button class="link" type="button" @click="renaming = ''">Cancel</button>
          </template>
          <template v-else-if="confirming === c.id">
            <!-- Said in full, because "delete" beside a list of students reads as deleting
                 students and this is the one destructive verb here that is not. -->
            <span class="warn">Remove this grouping? The
              {{ counts[c.id] || 0 }} {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }} in it
              keep their account, their courses and their progress.</span>
            <button class="btn danger" type="button" :disabled="!!busy" @click="destroy(c)">Delete</button>
            <button class="link" type="button" @click="confirming = ''">Cancel</button>
          </template>
          <template v-else>
            <div class="who">
              <strong>{{ c.title }}</strong>
              <small><code>{{ c.id }}</code> · {{ counts[c.id] || 0 }}
                {{ (counts[c.id] || 0) === 1 ? 'person' : 'people' }}<template v-if="c.archived"> · archived</template></small>
            </div>
            <button class="link" type="button" @click="startRename(c)">Rename</button>
            <button class="link" type="button" :disabled="!!busy" @click="setArchived(c, !c.archived)">
              {{ c.archived ? 'Restore' : 'Archive' }}
            </button>
            <button class="link danger" type="button" @click="confirming = c.id">Delete</button>
          </template>
        </li>
      <li v-if="!listed.length" class="none">No cohorts yet. Name one when you add or import
        somebody, and it appears here.</li>
    </ul>
  </section>
</template>

<style scoped>
.cohorts { max-width: 620px; }
.lead { margin: 0 0 18px; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.6;
        max-width: 60ch; }
.err { color: var(--ice-bad); font-size: 13px; margin: 0 0 12px; }

.list { list-style: none; margin: 0 0 18px; padding: 0;
        border: 1px solid var(--ice-border); border-radius: 8px; overflow: hidden; }
.list li { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
           border-bottom: 1px solid var(--ice-border); font-size: 14px; }
.list li:last-child { border-bottom: 0; }
.list li.off { opacity: .6; }
.list li.none { color: var(--ice-fg-muted); font-size: 13px; display: block; line-height: 1.5; }
.who { flex: 1; min-width: 0; }
.who strong { font-weight: 500; display: block; }
.who small { color: var(--ice-fg-muted); font-size: 12px; }
.who code { font-family: var(--ice-font-mono); font-size: .92em; }
.warn { flex: 1; font-size: 12.5px; color: var(--ice-bad); line-height: 1.45; }
input[type=text] { flex: 1; font: inherit; font-size: 14px; padding: 7px 10px;
                   background: var(--ice-bg); color: var(--ice-fg);
                   border: 1px solid var(--ice-border); border-radius: 8px; }
input:focus { outline: none; border-color: var(--ice-primary); }
.link.danger { color: var(--ice-bad); }
.btn.danger { color: var(--ice-bad); border-color: var(--ice-bad-line); }
</style>
