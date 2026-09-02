<script setup>
/* Your account: the one place a student is a PERSON rather than a position in a course.
 *
 * Everything the platform knows about somebody is currently either scattered across screens
 * that are about a course, visible only to an admin, or not visible at all. See ACCOUNT.md.
 *
 * A whole mode of its own rather than a pane of the player, for the reason AdminPanel is:
 * the exercise nav has nothing to offer it, and it has to be reachable from the grid, where
 * there is none.
 *
 * ONE PAGE, NOT FIVE TABS. The admin area is sections because its three are different
 * questions asked of different nouns; these five are all the same noun and a student
 * arriving here is usually going to one of them, having been told which. So it scrolls, and
 * `route.js` gives it no section for the same reason - nothing links to a heading.
 *
 * THE ORDER IS DELIBERATE: what they came to change, then what protects it, then what they
 * earned, then what we hold, then what they can destroy. Danger last and separated, because
 * everything above it is safe.
 */
import { ref, onMounted, nextTick } from 'vue';
import { api, changePassword, signOutEverywhere, session } from '../auth.js';

const props = defineProps({
  name: String,
  email: String,
});
const emit = defineEmits(['close']);

/* Everything the platform holds about this person, in one call.
 *
 * Fetched when the screen opens rather than at boot: the top bar needs a name and the
 * session already carries one, and nothing else here is worth a round trip on the way into
 * a course. Null until it lands, so each section can say "loading" rather than briefly
 * drawing zeroes - a nought is a real answer on this page and must not be shown as a
 * placeholder for one. */
const me = ref(null);
const loadError = ref('');

onMounted(async () => {
  try {
    me.value = await api('account');
  } catch (e) {
    loadError.value = e.message;
  }
});

/* The name. Same shape as the password form below it: collapsed until asked for, because
 * this page is mostly things to read. */
const editing = ref(false);
const draft = ref('');
const nameError = ref('');
const nameBusy = ref(false);

async function openName() {
  draft.value = me.value?.name || props.name || '';
  editing.value = true;
  nameError.value = '';
  await nextTick();
  document.getElementById('display-name')?.focus();
}

async function saveName() {
  const wanted = draft.value.trim();
  if (!wanted) { nameError.value = 'Your name cannot be empty.'; return; }
  nameBusy.value = true;
  nameError.value = '';
  try {
    const r = await api('account', { method: 'PUT', body: { name: wanted } });
    me.value.name = r.name;
    /* The top bar reads `session.name`, which came out of the id token - and that token was
     * minted before the rename, so nothing would change up there until the next sign-in.
     * Written here rather than re-fetching the session: the pool has just told us what the
     * name is now, and the token is not going to catch up either way. */
    session.name = r.name;
    editing.value = false;
  } catch (e) {
    nameError.value = e.message;
  } finally {
    nameBusy.value = false;
  }
}

/* Collapsed until asked for. This page is mostly things to read, and three password fields
 * standing open at the top of it make it look like a form that wants filling in. */
const changing = ref(false);
const current = ref('');
const next = ref('');
const again = ref('');
const pwError = ref('');
const pwNotice = ref('');
const pwBusy = ref(false);

async function openChange() {
  changing.value = true;
  pwError.value = '';
  pwNotice.value = '';
  await nextTick();
  document.getElementById('current-password')?.focus();
}

function closeChange() {
  changing.value = false;
  current.value = next.value = again.value = '';
  pwError.value = '';
}

async function savePassword() {
  pwError.value = '';
  if (next.value !== again.value) { pwError.value = 'Those two passwords do not match.'; return; }
  pwBusy.value = true;
  try {
    await changePassword(current.value, next.value);
    closeChange();
    /* Says what it did NOT do as well as what it did. Somebody changing a password because
     * they think someone else has it will read "password changed" as "they are out", and
     * they are not - see signOutEverywhere. The two controls sit together for this reason. */
    pwNotice.value = 'Your password is changed. Anywhere else you are signed in stays signed'
      + ' in until it expires - sign out everywhere if that matters.';
  } catch (e) {
    pwError.value = e.message;
  } finally {
    pwBusy.value = false;
  }
}

/* Two presses, because it signs the person doing it out as well - and the first press is on
 * a button whose name reads like a setting rather than an action. Not a modal: it undoes
 * nothing and costs a sign-in, so it does not want the weight of one. */
const confirming = ref(false);
const outBusy = ref(false);
const outError = ref('');

async function everywhere() {
  outBusy.value = true;
  outError.value = '';
  try {
    await signOutEverywhere();   // reloads the page on success
  } catch (e) {
    outError.value = e.message;
    outBusy.value = false;
    confirming.value = false;
  }
}

/* Declared rather than written into the template five times, so that the order above is a
 * list somebody can read and reorder rather than a property of the markup. `soon` is
 * temporary and each one leaves with the section it names - see ACCOUNT.md for the order
 * they arrive in. */
const SECTIONS = [
  { id: 'you', title: 'You',
    blurb: 'What you are called here, and the address you sign in with.' },
  { id: 'security', title: 'Security',
    blurb: 'Change your password, or sign out everywhere you are signed in.' },
  { id: 'learning', title: 'Learning',
    blurb: 'What you have earned, the hints you have left today, and which courses and '
         + 'class you are on.', soon: true },
  { id: 'data', title: 'Your data',
    blurb: 'Everything we hold about you, what it is for, and how to have it erased.',
    soon: true },
];
</script>

<template>
  <div class="account">
    <div class="card">
      <header>
        <div>
          <h2>Your account</h2>
          <p class="muted">Signed in as {{ email }}.</p>
        </div>
        <button class="btn ghost" @click="emit('close')">Done</button>
      </header>

      <!-- Every section is drawn from SECTIONS, built or not, so that the ORDER stays one
           list somebody can read and reorder rather than a property of the markup. A
           section arrives by growing a branch here and losing its `soon`. -->
      <section v-for="s in SECTIONS" :key="s.id" class="block">
        <h3>{{ s.title }}</h3>
        <p class="blurb">{{ s.blurb }}</p>

        <template v-if="s.id === 'you'">
          <dl class="facts">
            <dt>Name</dt>
            <dd>
              <form v-if="editing" class="inline" @submit.prevent="saveName">
                <input id="display-name" v-model="draft" maxlength="100" required>
                <button class="btn primary" type="submit" :disabled="nameBusy">
                  {{ nameBusy ? 'Saving…' : 'Save' }}
                </button>
                <button class="btn ghost" type="button" @click="editing = false">Cancel</button>
              </form>
              <span v-else class="inline">
                <span class="value">{{ me?.name || name }}</span>
                <button class="btn small" :disabled="!me" @click="openName">Edit</button>
              </span>
              <p v-if="nameError" class="err">{{ nameError }}</p>
            </dd>

            <dt>Email</dt>
            <dd>
              <span class="value">{{ me?.email || email }}</span>
              <!-- Says why rather than showing a disabled field. The pool declares email
                   immutable and a schema cannot be altered after the pool is created, so
                   this is not a policy that might be relaxed - Cognito would refuse the
                   write. It is also the sign-in alias, which makes changing it an identity
                   change rather than a preference. -->
              <p class="hint">This is how you sign in. Ask your tutor if it needs to change.</p>
            </dd>
          </dl>
        </template>

        <template v-else-if="s.id === 'security'">
          <!-- The form replaces the button rather than appearing under it, so there is
               never a stray "Change password" above three password fields. -->
          <form v-if="changing" class="form" @submit.prevent="savePassword">
            <label for="current-password">Current password</label>
            <input id="current-password" v-model="current" type="password"
                   autocomplete="current-password" required>

            <label for="next-password">New password</label>
            <input id="next-password" v-model="next" type="password"
                   autocomplete="new-password" required>

            <label for="again-password">Confirm it</label>
            <input id="again-password" v-model="again" type="password"
                   autocomplete="new-password" required>
            <!-- The same rule the sign-in card states, in the same words. -->
            <p class="hint">At least 12 characters, with a number.</p>

            <p v-if="pwError" class="err">{{ pwError }}</p>
            <div class="acts">
              <button class="btn primary" type="submit" :disabled="pwBusy">
                {{ pwBusy ? 'Just a moment…' : 'Change it' }}
              </button>
              <button class="btn ghost" type="button" @click="closeChange">Cancel</button>
            </div>
          </form>
          <div v-else class="acts">
            <button class="btn" @click="openChange">Change password</button>
          </div>
          <p v-if="pwNotice" class="ok">{{ pwNotice }}</p>

          <hr>

          <p class="blurb">Signing out everywhere revokes every device's right to sign back
            in without your password. Anywhere already open keeps working until its session
            expires — up to 12 hours — so it is not instant.</p>
          <p v-if="outError" class="err">{{ outError }}</p>
          <div class="acts">
            <template v-if="confirming">
              <button class="btn danger" :disabled="outBusy" @click="everywhere">
                {{ outBusy ? 'Signing out…' : 'Yes, sign out everywhere' }}
              </button>
              <button class="btn ghost" :disabled="outBusy" @click="confirming = false">Cancel</button>
            </template>
            <!-- Says it signs YOU out too, on the button that starts it: this is reached
                 from a page you are reading, and being logged out is the surprise. -->
            <button v-else class="btn" @click="confirming = true">
              Sign out everywhere, including here
            </button>
          </div>
        </template>

        <p v-else class="soon">Not built yet.</p>
      </section>

      <p v-if="loadError" class="err">{{ loadError }}</p>

      <!-- Outside the loop, and it stays outside it however many sections there are. It is
           the one part of this page that destroys something, and a danger zone that gets
           rendered by the same code as everything above it is one heading away from not
           looking like a danger zone at all. -->
      <section class="block danger">
        <h3>Danger zone</h3>
        <p class="blurb">Start a course again from nothing. Your enrolment stays; the record
          of what you have done on it does not.</p>
        <p class="soon">Not built yet.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Deliberately the same frame as AdminPanel: both are full-screen modes reached from the
   top bar, and two different paddings would read as two different products. Narrower,
   though - the admin card is 1040px because it holds a table of people, and this holds
   prose and a handful of fields. */
.account { height: 100%; overflow: auto; padding: 40px 32px; display: flex; justify-content: center; }
.card { width: min(720px, 100%); }

header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px;
         margin-bottom: 26px; }
h2 { margin: 0; font-size: 22px; }
.muted { color: var(--ice-fg-muted); font-size: 13px; margin: 8px 0 0; }

.block { border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
         padding: 18px 20px; margin-bottom: 14px; }
h3 { margin: 0 0 6px; font-size: 15px; }
.blurb { color: var(--ice-fg-muted); font-size: 13px; margin: 0; max-width: 60ch;
         line-height: 1.6; }
.soon { color: var(--ice-fg-muted); font-size: 12px; margin: 10px 0 0; opacity: .7; }

.form { display: flex; flex-direction: column; margin-top: 14px; max-width: 320px; }
label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ice-fg-muted); margin-bottom: 6px; }
input { font: inherit; font-size: 14px; padding: 9px 11px; margin-bottom: 14px;
        background: var(--ice-bg); color: var(--ice-fg);
        border: 1px solid var(--ice-border); border-radius: 8px; }
input:focus { outline: none; border-color: var(--ice-primary); }
.hint { color: var(--ice-fg-muted); font-size: 12px; margin: -4px 0 12px; }
.err { color: var(--ice-bad); font-size: 13px; margin: 0 0 12px; }
.ok { color: var(--ice-fg-muted); font-size: 13px; margin: 12px 0 0; max-width: 60ch;
      line-height: 1.6; }
.acts { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

/* A definition list because that is what it is: a label and the fact it names. Grid rather
   than the default block flow so the values line up down the page whatever the labels are
   called. */
.facts { display: grid; grid-template-columns: minmax(0, 96px) minmax(0, 1fr);
         gap: 12px 16px; margin: 16px 0 0; align-items: baseline; }
.facts dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
            color: var(--ice-fg-muted); }
.facts dd { margin: 0; min-width: 0; }
.value { font-size: 14px; }
.inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.inline input { margin-bottom: 0; max-width: 260px; }
.btn.small { font-size: 12px; padding: 4px 9px; }
/* Both were shaped to sit under an input, where the field's own bottom margin is the gap.
   Here they sit under a value and need one of their own. */
.facts .hint { margin: 6px 0 0; }
.facts .err { margin: 8px 0 0; }
hr { border: 0; border-top: 1px solid var(--ice-border); margin: 20px 0 16px; }

/* Separated by a gap and a colour, not by a heading alone - it is the last thing on the
   page and it should read as a different kind of thing before it is read at all. */
.danger { margin-top: 34px; border-color: var(--ice-bad); }
.danger h3 { color: var(--ice-bad); }
</style>
