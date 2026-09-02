<script setup>
/* One person: invite them, or change everything about them.
 *
 * Add and edit are the same form because they are the same facts - who they are, what they
 * are on, and whether they can invite others. What editing adds is the things that only
 * exist once an account does: reissuing an invitation that has gone stale, suspending
 * somebody who has left, and deleting them outright.
 *
 * It talks to the API itself and reports back a sentence, rather than handing intents up to
 * AdminPanel: the panel would then need a branch per action and an error slot per branch,
 * and the failure it has to show is always about the one user in front of you.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { api, session } from '../auth.js';

const props = defineProps({
  /** null to invite somebody new; otherwise the row from the listing. */
  user: Object,
  courses: Array,
  cohorts: Array,
});
const emit = defineEmits(['done', 'close']);

const editing = computed(() => !!props.user);
/* An admin editing themselves may change their name and their courses, and may not take
 * away their own rights: only the `admins` group can reach this screen, so demoting or
 * suspending yourself locks you out of the tool that would undo it. The API refuses it too
 * - this is so the button is not there to be pressed. */
const isSelf = computed(() => !!props.user && props.user.email === session.email);

const email = ref(props.user?.email || '');
const name = ref(props.user?.name || '');
const admin = ref(!!props.user?.admin);
const picked = ref(new Set(props.user?.courses || []));
/* Ids for cohorts that exist, and the RAW NAME for one being invented here. The API
 * resolves both the same way - id, then title, then create - so this screen does not have
 * to make a cohort before it can put somebody in one, and two admins inventing the same
 * intake at once still land in one cohort rather than two. */
const inCohorts = ref(new Set(props.user?.cohorts || []));
const newCohort = ref('');

const busy = ref('');
const error = ref('');
const confirming = ref(false);
const typed = ref('');
const first = ref(null);

onMounted(() => first.value?.focus());

const toggle = id => {
  const next = new Set(picked.value);
  next.has(id) ? next.delete(id) : next.add(id);
  picked.value = next;
};

const toggleCohort = id => {
  const next = new Set(inCohorts.value);
  next.has(id) ? next.delete(id) : next.add(id);
  inCohorts.value = next;
};

/* An archived cohort is off the list, EXCEPT for somebody already in it: dropping it
 * silently would take them out of a finished intake the moment anyone saved this form. */
const cohortList = computed(() => {
  const known = props.cohorts || [];
  const shown = known.filter(c => !c.archived || inCohorts.value.has(c.id));
  const invented = [...inCohorts.value].filter(id => !known.some(c => c.id === id));
  return [
    ...shown.map(c => ({ id: c.id, title: c.title, archived: c.archived })),
    ...invented.map(id => ({ id, title: id, fresh: true })),
  ].sort((a, b) => {
    const on = c => (inCohorts.value.has(c.id) ? 0 : 1);
    return on(a) - on(b) || a.title.localeCompare(b.title);
  });
});

function addCohort() {
  const title = newCohort.value.trim();
  if (!title) return;
  // Matched against what exists before it becomes a new one, so typing the name of a
  // cohort that is already in the list ticks it rather than making a second one.
  const hit = (props.cohorts || []).find(c =>
    c.id === title || c.title.trim().toLowerCase() === title.toLowerCase());
  toggleCohort(hit ? hit.id : title);
  newCohort.value = '';
}

const invited = computed(() => props.user?.status === 'FORCE_CHANGE_PASSWORD');

/* Sorted so the tick list reads the way the grid does, with the courses a student is
 * actually enrolled on first. A dozen courses in publication order makes checking what
 * somebody is on a hunt. */
const listed = computed(() => [...(props.courses || [])].sort((a, b) => {
  const on = c => (picked.value.has(c.id) ? 0 : 1);
  return on(a) - on(b) || a.title.localeCompare(b.title);
}));

async function run(label, fn) {
  error.value = ''; busy.value = label;
  try { emit('done', await fn()); }
  catch (e) { error.value = e.message; }
  finally { busy.value = ''; }
}

const save = () => run('save', async () => {
  if (editing.value) {
    await api('admin/users', {
      method: 'PUT',
      body: {
        sub: props.user.sub,
        name: name.value.trim(),
        courses: [...picked.value],
        cohorts: [...inCohorts.value],
        ...(isSelf.value ? {} : { admin: admin.value }),
      },
    });
    return `${name.value.trim() || email.value} updated.`;
  }
  const address = email.value.trim().toLowerCase();
  const r = await api('admin/users', {
    method: 'POST',
    body: {
      email: address,
      name: name.value.trim() || undefined,
      courses: [...picked.value],
      cohorts: [...inCohorts.value],
      admin: admin.value,
    },
  });
  return r.invited
    ? `Invitation sent to ${address}.`
    : `${address} already had an account, and is now on ${picked.value.size || 'no'} course${picked.value.size === 1 ? '' : 's'}.`;
});

const resend = () => run('resend', async () => {
  await api('admin/users', { method: 'POST', body: { email: props.user.email, resend: true } });
  return `A fresh invitation is on its way to ${props.user.email}.`;
});

const setEnabled = enabled => run('enabled', async () => {
  await api('admin/users', { method: 'PUT', body: { sub: props.user.sub, enabled } });
  return enabled
    ? `${props.user.email} can sign in again.`
    : `${props.user.email} is suspended and cannot sign in.`;
});

const destroy = () => run('delete', async () => {
  const r = await api(`admin/users?sub=${encodeURIComponent(props.user.sub)}`, { method: 'DELETE' });
  return `${props.user.email} deleted, along with ${r.removed} row${r.removed === 1 ? '' : 's'} of enrolment and progress.`;
});

// Typing the address out is the point: this deletes their progress as well as their
// account, and there is nothing to restore it from.
const canDelete = computed(() => typed.value.trim().toLowerCase() === props.user?.email);
watch(confirming, v => { if (!v) typed.value = ''; });
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" @keydown.esc="confirming ? confirming = false : emit('close')">
      <header>
        <h2>{{ editing ? 'Edit user' : 'Add a user' }}</h2>
        <button class="x" title="Close" @click="emit('close')">✕</button>
      </header>

      <form @submit.prevent="save">
        <div class="pair">
          <div>
            <label for="ud-email">Email</label>
            <input id="ud-email" ref="first" v-model="email" type="email" required
                   :disabled="editing" placeholder="student@example.com">
            <p v-if="editing" class="hint">An address is the account. To change it, delete and re-invite.</p>
          </div>
          <div>
            <label for="ud-name">Name <span class="opt">optional</span></label>
            <input id="ud-name" v-model="name" type="text" placeholder="Jane Borg">
            <p class="hint">Left blank, they are called {{ (email.split('@')[0] || 'jane.borg') }}.</p>
          </div>
        </div>

        <label>Courses</label>
        <ul class="courses">
          <li v-for="c in listed" :key="c.id">
            <label class="tick">
              <input type="checkbox" :checked="picked.has(c.id)" @change="toggle(c.id)">
              <span class="title">{{ c.title }}</span>
              <!-- An open course is on everybody's grid without an enrolment row, so
                   ticking it changes nothing a student can see. Say so rather than hide it:
                   its absence from the list would read as the course being missing. -->
              <span v-if="c.open" class="tag">open to everyone</span>
              <span v-else-if="c.playground" class="tag">playground</span>
            </label>
          </li>
          <li v-if="!listed.length" class="none">No courses are published yet.</li>
        </ul>
        <!-- Kept and still editable, because these rows are what they are left on if their
             rights are ever removed. But an admin already sees the whole catalogue, so
             ticks that look like a limit have to say that they are not one. -->
        <p v-if="admin" class="hint above">An admin sees every course. These only decide
          what they are on if their rights are removed.</p>

        <label>Cohorts <span class="opt">optional</span></label>
        <ul v-if="cohortList.length" class="courses short">
          <li v-for="c in cohortList" :key="c.id">
            <label class="tick">
              <input type="checkbox" :checked="inCohorts.has(c.id)" @change="toggleCohort(c.id)">
              <span class="title">{{ c.title }}</span>
              <span v-if="c.fresh" class="tag new">new</span>
              <span v-else-if="c.archived" class="tag">archived</span>
            </label>
          </li>
        </ul>
        <div class="pair tight newco">
          <input v-model="newCohort" type="text" placeholder="Or name a new one - Sept 2026 evening"
                 @keydown.enter.prevent="addCohort">
          <button class="btn" type="button" :disabled="!newCohort.trim()" @click="addCohort">Add</button>
        </div>
        <p class="hint above">A cohort is a class or an intake. It groups people, and it is
          not tied to a course.</p>

        <label class="tick admin" :class="{ off: isSelf }">
          <input type="checkbox" v-model="admin" :disabled="isSelf">
          <span>
            <strong>Can manage users</strong>
            <small>Invite, edit and remove people, and see this screen.</small>
          </span>
        </label>
        <p v-if="isSelf" class="hint self">This is you. You cannot take away your own rights
          or suspend yourself - ask another admin, or use <code>just grant-admin</code>.</p>

        <p v-if="error" class="err">{{ error }}</p>

        <footer>
          <button class="btn ghost" type="button" @click="emit('close')">Cancel</button>
          <button class="btn primary" type="submit" :disabled="!!busy || (!editing && !email.trim())">
            {{ busy === 'save' ? 'Saving…' : editing ? 'Save changes' : 'Invite &amp; enrol' }}
          </button>
        </footer>
      </form>

      <section v-if="editing && !isSelf" class="more">
        <h3>Account</h3>
        <div class="row">
          <div>
            <strong>Invitation</strong>
            <small v-if="invited">Sent, and not used yet. A temporary password lasts seven days.</small>
            <small v-else>Already used - they have chosen their own password.</small>
          </div>
          <button class="btn" type="button" :disabled="!invited || !!busy" @click="resend">
            {{ busy === 'resend' ? 'Sending…' : 'Resend' }}
          </button>
        </div>
        <div class="row">
          <div>
            <strong>{{ user.enabled ? 'Active' : 'Suspended' }}</strong>
            <small>Suspending blocks sign-in and keeps everything they have done.</small>
          </div>
          <button class="btn" type="button" :disabled="!!busy" @click="setEnabled(!user.enabled)">
            {{ user.enabled ? 'Suspend' : 'Restore' }}
          </button>
        </div>
        <div class="row danger">
          <div>
            <strong>Delete</strong>
            <small>The account and every exercise they have solved. Nothing keeps a copy.</small>
          </div>
          <button v-if="!confirming" class="btn danger" type="button" @click="confirming = true">Delete…</button>
          <button v-else class="btn ghost" type="button" @click="confirming = false">Cancel</button>
        </div>
        <div v-if="confirming" class="confirm">
          <label for="ud-confirm">Type <code>{{ user.email }}</code> to confirm</label>
          <div class="pair tight">
            <input id="ud-confirm" v-model="typed" type="text" autocomplete="off" :placeholder="user.email">
            <button class="btn danger" type="button" :disabled="!canDelete || !!busy" @click="destroy">
              {{ busy === 'delete' ? 'Deleting…' : 'Delete permanently' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; background: var(--ice-scrim); z-index: 60;
         display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px; overflow: auto; }
.dialog { width: min(620px, 100%); background: var(--ice-bg); border: 1px solid var(--ice-border);
          border-radius: var(--ice-radius); padding: 22px 24px 24px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
h2 { margin: 0; font-size: 18px; }
.x { background: none; border: 0; color: var(--ice-fg-muted); font-size: 15px; cursor: pointer; padding: 4px 6px; }
.x:hover { color: var(--ice-fg); }
label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ice-fg-muted); margin-bottom: 6px; }
.opt { text-transform: none; letter-spacing: 0; opacity: .7; }
input[type=text], input[type=email] {
  width: 100%; font: inherit; font-size: 14px; padding: 9px 11px;
  background: var(--ice-bg); color: var(--ice-fg);
  border: 1px solid var(--ice-border); border-radius: 8px; }
input:focus { outline: none; border-color: var(--ice-primary); }
input:disabled { opacity: .6; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
.pair.tight { grid-template-columns: 1fr auto; gap: 8px; margin: 0; align-items: center; }
.hint { margin: 5px 0 0; font-size: 11.5px; color: var(--ice-fg-muted); line-height: 1.45; }
.hint.self { margin: -6px 0 14px; }
.hint.above { margin: -12px 0 16px; }
.courses.short { max-height: 132px; margin-bottom: 10px; }
.newco { margin-bottom: 6px; }
.newco input { width: 100%; }
.tag.new { color: var(--ice-primary-strong); border-color: var(--ice-primary-soft); }
.hint code { font-family: var(--ice-font-mono); font-size: .9em; }

.courses { list-style: none; margin: 0 0 18px; padding: 8px; display: grid; gap: 2px;
           max-height: 210px; overflow: auto;
           border: 1px solid var(--ice-border); border-radius: 8px; background: var(--ice-bg-soft); }
.courses li.none { color: var(--ice-fg-muted); font-size: 13px; padding: 6px 8px; }
.tick { display: flex; align-items: center; gap: 10px; text-transform: none; letter-spacing: 0;
        font-size: 14px; color: var(--ice-fg); margin: 0; padding: 6px 8px;
        border-radius: 6px; cursor: pointer; }
.tick:hover { background: var(--ice-raise); }
.tick input { accent-color: var(--ice-primary); width: 15px; height: 15px; flex: none; }
.title { flex: 1; }
.tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--ice-fg-muted);
       border: 1px solid var(--ice-border); background: var(--ice-bg); border-radius: 5px; padding: 1px 6px; }
.tick.admin { align-items: flex-start; padding: 12px 14px; margin-bottom: 16px;
              border: 1px solid var(--ice-border); border-radius: 8px; background: var(--ice-bg-soft); }
.tick.admin input { margin-top: 3px; }
.tick.admin small { display: block; color: var(--ice-fg-muted); font-size: 12px; }
.tick.off { opacity: .55; cursor: not-allowed; }

.err { color: var(--ice-bad); font-size: 13px; margin: 0 0 12px; }
footer { display: flex; justify-content: flex-end; gap: 10px; }

.more { margin-top: 26px; padding-top: 8px; border-top: 1px solid var(--ice-border); }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--ice-fg-muted); margin: 16px 0 10px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
       padding: 11px 0; border-bottom: 1px solid var(--ice-border); }
.row:last-of-type { border-bottom: 0; }
.row strong { font-size: 14px; font-weight: 500; }
.row small { display: block; color: var(--ice-fg-muted); font-size: 12px; line-height: 1.45; }
.confirm { background: var(--ice-bad-fill); border: 1px solid var(--ice-bad-line);
           border-radius: 8px; padding: 12px 14px; margin-top: 4px; }
.confirm label { color: var(--ice-bad); text-transform: none; letter-spacing: 0; font-size: 12.5px; }
.confirm code { font-family: var(--ice-font-mono); font-size: .92em; }
@media (max-width: 620px) { .pair { grid-template-columns: 1fr; } }
</style>
