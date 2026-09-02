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
import { ref, computed, onMounted, nextTick } from 'vue';
import { api, changePassword, signOutEverywhere, session } from '../auth.js';
import * as store from '../progress-store.js';
import { normalise, avatarSrc } from '../avatar.js';

const props = defineProps({
  name: String,
  email: String,
  /** Every published course, for titles. The API cannot supply them: the catalogue lives in
   *  the content bucket, so that function knows which courses somebody is ON and not what
   *  any of them is called - the same reason the admin listing queries per user. */
  courses: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'reset']);

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

/* What each course of theirs has earned.
 *
 * THE UNION OF ENROLMENT AND PROGRESS, not either alone. A course they are on with nothing
 * done yet belongs here, or a new student's Learning section is empty and reads as broken.
 * And a course with XP but no enrolment row is a real state twice over - an admin, who sees
 * every course without being enrolled on any, and a student who has been unenrolled since -
 * so the work is shown rather than silently dropped along with the row that named it.
 *
 * Sorted by what they have earned, because the course somebody is furthest through is the
 * one they came here about. Ties go alphabetical rather than to whatever order the ids
 * arrived in, which is a partition's and means nothing to a reader. */
const learning = computed(() => {
  if (!me.value) return [];
  const titles = new Map(props.courses.map(c => [c.id, c.title]));
  const earned = me.value.xp?.byCourse || {};
  const on = me.value.courses || [];
  const ids = [...new Set([...on, ...Object.keys(earned)])];
  return ids.map(id => ({
    id,
    title: titles.get(id) || id,
    enrolled: on.includes(id),
    solved: earned[id]?.solved || 0,
    xp: earned[id]?.xp || 0,
  })).sort((a, b) => b.xp - a.xp || a.title.localeCompare(b.title));
});

const num = n => Number(n || 0).toLocaleString();

/* ---- the picture -------------------------------------------------------------------
 *
 * The file never reaches the network. `normalise` decodes it, crops it square and re-encodes
 * it, so what is sent is ~15KB of pixels the browser drew rather than whatever came off a
 * phone - see avatar.js for why that is a security property and not only a size one.
 */
const picking = ref(null);      // the hidden <input type=file>
const avatarBusy = ref(false);
const avatarError = ref('');

/* Through avatar.js, which the top bar also uses - the two renderers of one key. */
const portrait = computed(() => avatarSrc(me.value?.avatar));

async function pickAvatar(event) {
  const file = event.target.files?.[0];
  // Cleared straight away, or choosing the SAME file twice in a row fires no change event
  // and the second attempt looks like a dead button.
  event.target.value = '';
  if (!file) return;
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    const { data, type } = await normalise(file);
    const r = await api('account/avatar', { method: 'POST', body: { data, type } });
    me.value.avatar = r.avatar;
    session.avatar = r.avatar;   // the top bar, for the reason the rename writes session.name
  } catch (e) {
    avatarError.value = e.message;
  } finally {
    avatarBusy.value = false;
  }
}

async function removeAvatar() {
  avatarBusy.value = true;
  avatarError.value = '';
  try {
    await api('account/avatar', { method: 'DELETE' });
    me.value.avatar = null;
    session.avatar = '';
  } catch (e) {
    avatarError.value = e.message;
  } finally {
    avatarBusy.value = false;
  }
}

/* ---- the access request ------------------------------------------------------------
 *
 * The download is built here rather than served as a file, because the endpoint is behind
 * the API's JWT authorizer: a plain link carries no Authorization header and would 401. So
 * `api()` fetches it as it fetches everything else, and the Blob is made from what came
 * back.
 */
const exporting = ref(false);
const exportError = ref('');

async function download() {
  exporting.value = true;
  exportError.value = '';
  try {
    const all = await api('account/export');
    /* Two-space JSON, not minified. Article 12(1) asks for an intelligible form, and this is
     * a file somebody may well open in a text editor rather than feed to anything. */
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `icecampus-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Revoked on the next task rather than immediately: Safari has not started reading the
    // blob by the time click() returns, and revoking synchronously gives an empty file.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) {
    exportError.value = e.message;
  } finally {
    exporting.value = false;
  }
}

/* The statement, shown as well as sent. It arrives with the account summary rather than on
 * a call of its own - it is a constant with no personal data in it, so it costs a couple of
 * kilobytes and saves a round trip and a loading state for static text. */
const about = computed(() => me.value?.about);

/* ---- the danger zone -------------------------------------------------------------
 *
 * TWO GATES, and they guard different mistakes. The first is "did you mean to do this at
 * all", answered with numbers rather than adjectives - "47 solved exercises and 2,350 XP"
 * is a different decision from "this cannot be undone". The second is "did you mean THIS
 * course", and only it can catch the real failure here, which is not an accidental click
 * but resetting the wrong course.
 *
 * The phrase is the COURSE TITLE, never the word DELETE. A generic token is typed by muscle
 * memory and confirms only that a human is present; the title confirms which course. */
const resetting = ref(null);      // the course being reset, once the first gate is passed
const typed = ref('');
const resetError = ref('');
const resetBusy = ref(false);
const resetDone = ref('');

/* Only courses with something to lose. Resetting one that has nothing on it is a no-op
 * dressed as a destructive act, and offering it is how a danger zone becomes a place people
 * learn to click through. */
const resettable = computed(() => learning.value.filter(c => c.solved > 0));

function askReset(course) {
  resetting.value = course;
  typed.value = '';
  resetError.value = '';
  resetDone.value = '';
}

/* Case-insensitive and trimmed, because this is a confirmation and not a password: somebody
 * who has typed the title of the course in front of them has confirmed which course they
 * mean, whatever they did with the shift key. */
const matches = computed(() =>
  typed.value.trim().toLowerCase() === (resetting.value?.title || '').trim().toLowerCase());

async function doReset() {
  if (!matches.value) return;
  const course = resetting.value;
  resetBusy.value = true;
  resetError.value = '';
  try {
    await api(`account/progress?course=${encodeURIComponent(course.id)}`, { method: 'DELETE' });
    /* THE RESET IS TWO-SIDED. progress.js falls back to the local record whenever a call
     * fails, so clearing the rows alone leaves a browser that re-asserts the progress that
     * was just deleted the next time anything goes offline. */
    store.forget(course.id);
    /* Re-read rather than patched in place: the reset changes the total, the course's row
     * and what is resettable at all, and three edits by hand is three chances for this
     * screen to disagree with the rows it just changed. */
    me.value = await api('account');
    resetting.value = null;
    resetDone.value = `${course.title} is back to nothing. Your enrolment is untouched.`;
    /* The grid behind this screen is drawn from a tally App.vue took when the courses
     * loaded, and nothing about closing the account screen recomputes it - so without this
     * a student resets a course, presses Done, and sees the card still claiming the XP they
     * just cleared. */
    emit('reset');
  } catch (e) {
    resetError.value = e.message;
  } finally {
    resetBusy.value = false;
  }
}

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
    blurb: 'Your picture, what you are called here, and the address you sign in with.' },
  { id: 'security', title: 'Security',
    blurb: 'Change your password, or sign out everywhere you are signed in.' },
  { id: 'learning', title: 'Learning',
    blurb: 'What you have earned, the hints you have left today, and which courses and '
         + 'class you are on.' },
  { id: 'data', title: 'Your data',
    blurb: 'Everything we hold about you, what it is for, and how to have it erased.' },
];
</script>

<template>
  <div class="account">
    <div class="card">
      <!-- OUTSIDE THE SECTION LOOP, and that is the whole reason it is up here. A `ref`
           inside a v-for collects into an ARRAY of elements rather than binding one, so
           `picking.click()` was `[input].click()` - a TypeError on the button that opens
           the file dialog. It is hidden, so where it sits in the DOM does not matter. -->
      <input ref="picking" type="file" accept="image/*" hidden @change="pickAvatar">
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
          <div class="portrait">
            <img v-if="portrait" class="big" :src="portrait" alt="">
            <!-- The same fallback the top bar uses, at the size this page shows. Initials
                 are the only fallback: no generated identicon, which would be a second thing
                 to design and to keep looking deliberate. -->
            <span v-else class="big initials">{{ (me?.name || name || '?').trim()[0]?.toUpperCase() }}</span>
            <div class="portrait-acts">
              <button class="btn" :disabled="avatarBusy || !me" @click="picking?.click()">
                {{ avatarBusy ? 'Working…' : (me?.avatar ? 'Change picture' : 'Add a picture') }}
              </button>
              <button v-if="me?.avatar" class="btn ghost" :disabled="avatarBusy"
                      @click="removeAvatar">Remove</button>
              <!-- Says what happens to the file, because it is not what anyone assumes: it
                   is cropped and re-encoded here, and the original never leaves the machine.
                   That is also what strips the location out of a phone photo. -->
              <p class="hint">Cropped square and shrunk in your browser — the original file
                is never uploaded, so nothing hidden in it is either.</p>
            </div>
          </div>
          <p v-if="avatarError" class="err">{{ avatarError }}</p>

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

        <template v-else-if="s.id === 'learning'">
          <p v-if="!me" class="soon">Loading…</p>
          <template v-else>
            <!-- The two facts that are about the PERSON rather than about a course, so they
                 sit above the per-course list rather than inside it. -->
            <div class="tallies">
              <div class="tally">
                <strong>{{ num(me.xp?.total) }}</strong>
                <span>XP earned, all time</span>
              </div>
              <div class="tally">
                <strong>{{ num(me.hints?.left) }}</strong>
                <!-- Says the limit, not just what is left. A student otherwise meets it for
                     the first time as a refusal mid-exercise. -->
                <span>hints left today, of {{ num(me.hints?.limit) }}</span>
              </div>
            </div>

            <ul v-if="learning.length" class="courses">
              <li v-for="c in learning" :key="c.id">
                <span class="cname">
                  {{ c.title }}
                  <!-- NOT for an admin, for whom it is true of every row and therefore
                       says nothing: they see every course without being enrolled on any.
                       For a student it is the one case worth marking - work on a course
                       they have since been taken off, which is kept on the page rather
                       than dropped along with the row that named it. -->
                  <em v-if="!c.enrolled && !me.admin">not enrolled</em>
                </span>
                <span class="cnum">{{ num(c.solved) }} solved</span>
                <span class="cnum">{{ num(c.xp) }} XP</span>
              </li>
            </ul>
            <p v-else-if="me.admin" class="hint">Nothing solved yet.</p>
            <p v-else class="hint">You are not on any courses yet.</p>
            <!-- Said once under the list rather than once per row: for an admin it is a
                 property of being an admin, not of any particular course. -->
            <p v-if="me.admin" class="hint">You are an admin, so every course is open to you
              whether or not you are enrolled on it.</p>

            <dl class="facts">
              <dt>Class</dt>
              <dd>
                <span v-if="me.cohorts?.length" class="value">
                  <template v-for="(c, i) in me.cohorts" :key="c.id">{{ i ? ', ' : ''
                    }}{{ c.title }}<em v-if="c.archived"> (finished)</em></template>
                </span>
                <span v-else class="value muted-value">Not in a class.</span>
                <!-- The read-only rule, said rather than implied by an absence of buttons.
                     Enrolment and class are an admin's to set: a student who could take
                     themselves off a course would lose one they were put on, and it would
                     look from the admin panel exactly like an administrative mistake. -->
                <p class="hint">Your courses and class are set by your tutor. Ask them if
                  something here is wrong.</p>
              </dd>
            </dl>
          </template>
        </template>

        <template v-else-if="s.id === 'data'">
          <p v-if="!about" class="soon">Loading…</p>
          <template v-else>
            <div class="acts">
              <button class="btn" :disabled="exporting" @click="download">
                {{ exporting ? 'Gathering…' : 'Download everything' }}
              </button>
            </div>
            <p v-if="exportError" class="err">{{ exportError }}</p>
            <p class="hint">A JSON file with everything below in it, including the code you
              wrote for every exercise you have solved.</p>

            <!-- THE SAME OBJECT THE FILE CARRIES, rendered rather than rewritten. Article 15
                 wants a copy of the data AND this; a page that showed different words from
                 the ones in the download would be two answers to one question. -->
            <dl class="statement">
              <dt>Who holds it</dt>
              <dd>
                {{ about.controller.name }}<template v-if="about.controller.contact">.
                Questions and requests: {{ about.controller.contact }}</template>
              </dd>

              <dt>What it is for</dt>
              <dd><ul><li v-for="(x, i) in about.purposes" :key="i">{{ x }}</li></ul></dd>

              <dt>What we hold</dt>
              <dd><ul><li v-for="(x, i) in about.categories" :key="i">{{ x }}</li></ul></dd>

              <dt>Who else sees it</dt>
              <dd><ul><li v-for="(x, i) in about.recipients" :key="i">{{ x }}</li></ul></dd>

              <dt>How long</dt>
              <dd><ul><li v-for="(x, i) in about.retention" :key="i">{{ x }}</li></ul></dd>

              <dt>Where it came from</dt>
              <dd>{{ about.source }}</dd>

              <dt>Automated decisions</dt>
              <dd>{{ about.automated }}</dd>

              <dt>Your rights</dt>
              <dd><ul><li v-for="(x, i) in about.rights" :key="i">{{ x }}</li></ul></dd>

              <!-- Erasure is a REQUEST rather than a button, and the page says so plainly
                   rather than leaving it out. Deleting an account is also an enrolment
                   decision - a student on a paid course who clears their own record destroys
                   the evidence of what they were entitled to, and forget() removes the
                   Cognito user first, so there is nobody left to ask what happened. -->
              <dt>Being erased</dt>
              <dd>
                Ask <template v-if="about.controller.contact">{{ about.controller.contact
                  }}</template><template v-else>your tutor</template>, or your tutor, and your
                account and everything above is deleted. It is not a button here because
                deleting your account also ends your enrolment, and that is a decision worth
                a person reading.
              </dd>

              <dt>If we get it wrong</dt>
              <dd>{{ about.complaint }}</dd>
            </dl>
          </template>
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
        <p class="blurb">Start a course again from nothing. Your enrolment stays and so does
          your class; the record of what you have done on the course does not.</p>

        <p v-if="!me" class="soon">Loading…</p>

        <!-- The second gate. Replaces the list rather than sitting under it, so there is
             nothing else to press while it is open. -->
        <div v-else-if="resetting" class="gate">
          <p class="blurb">
            This clears <strong>{{ num(resetting.solved) }}</strong>
            solved {{ resetting.solved === 1 ? 'exercise' : 'exercises' }} and
            <strong>{{ num(resetting.xp) }} XP</strong> on
            <strong>{{ resetting.title }}</strong>, along with the answers you wrote. It
            cannot be undone.
          </p>
          <label for="confirm-title">Type <strong>{{ resetting.title }}</strong> to confirm</label>
          <input id="confirm-title" v-model="typed" autocomplete="off" autocapitalize="off"
                 spellcheck="false">
          <p v-if="resetError" class="err">{{ resetError }}</p>
          <div class="acts">
            <button class="btn danger" :disabled="!matches || resetBusy" @click="doReset">
              {{ resetBusy ? 'Clearing…' : 'Reset this course' }}
            </button>
            <button class="btn ghost" :disabled="resetBusy" @click="resetting = null">Cancel</button>
          </div>
        </div>

        <template v-else>
          <ul v-if="resettable.length" class="courses">
            <li v-for="c in resettable" :key="c.id">
              <span class="cname">{{ c.title }}</span>
              <span class="cnum">{{ num(c.solved) }} solved</span>
              <span class="cnum">{{ num(c.xp) }} XP</span>
              <button class="btn small danger" @click="askReset(c)">Reset…</button>
            </li>
          </ul>
          <!-- A course with nothing on it is not offered: a no-op dressed as a destructive
               act is how a danger zone becomes a place people learn to click through. -->
          <p v-else class="hint">Nothing to reset — you have not solved anything yet.</p>
          <p v-if="resetDone" class="ok">{{ resetDone }}</p>
        </template>
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

/* The two person-level numbers, side by side and reading as figures rather than as prose -
   they are the answer somebody opened this section for. */
.tallies { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 0; }
.tally { flex: 1 1 180px; border: 1px solid var(--ice-border); border-radius: 10px;
         padding: 12px 14px; background: var(--ice-raise-soft); }
.tally strong { display: block; font-family: var(--ice-font-mono);
                font-variant-numeric: tabular-nums; font-size: 22px; line-height: 1.1; }
.tally span { display: block; margin-top: 4px; font-size: 12px; color: var(--ice-fg-muted); }

.courses { list-style: none; margin: 14px 0 0; padding: 0;
           border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
           overflow: hidden; }
.courses li { display: flex; align-items: baseline; gap: 14px; padding: 11px 14px;
              border-bottom: 1px solid var(--ice-border); font-size: 13px; }
.courses li:last-child { border-bottom: 0; }
.cname { flex: 1; min-width: 0; font-weight: 500; }
.cname em { font-style: normal; font-size: 11px; color: var(--ice-fg-muted);
            margin-left: 6px; }
/* Tabular, and a fixed column, so two rows of numbers line up rather than wandering with
   the width of the figure beside them. */
.cnum { flex: none; min-width: 74px; text-align: right; font-family: var(--ice-font-mono);
        font-variant-numeric: tabular-nums; font-size: 12px; color: var(--ice-fg-muted); }
.muted-value { color: var(--ice-fg-muted); }
/* The cohort's "(finished)" marker, matching the list's own aside rather than arriving as
   the browser's default italic. */
.value em { font-style: normal; color: var(--ice-fg-muted); }

/* A definition list again, but reading as prose rather than as fields: these are questions
   and answers, so the label sits above its answer instead of beside it. Beside it, the
   answers - which are lists of full sentences - would be squeezed into half the width. */
.statement { margin: 20px 0 0; }
.statement dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
                color: var(--ice-fg-muted); margin-top: 18px; }
.statement dt:first-child { margin-top: 0; }
.statement dd { margin: 6px 0 0; font-size: 13px; line-height: 1.65; max-width: 68ch; }
.statement ul { margin: 0; padding-left: 18px; }
.statement li { margin: 3px 0; }

.portrait { display: flex; align-items: flex-start; gap: 16px; margin: 18px 0 4px; }
/* Width and height set outright rather than left to content, for the reason the top bar's
   26px circle is: padding sizes a box to its text, and one initial then comes out an oval. */
.big { flex: none; width: 72px; height: 72px; border-radius: 50%; object-fit: cover;
       background: var(--ice-primary-soft); }
.initials { display: inline-flex; align-items: center; justify-content: center;
            color: var(--ice-primary-strong); font-size: 26px; font-weight: 600;
            line-height: 1; }
.portrait-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.portrait-acts .hint { flex-basis: 100%; margin: 0; max-width: 46ch; }

.gate { margin-top: 16px; }
.gate label { display: block; margin: 16px 0 6px; text-transform: none; letter-spacing: 0;
              font-size: 13px; color: var(--ice-fg); }
.gate input { max-width: 320px; margin-bottom: 0; }
.gate .blurb strong { color: var(--ice-fg); }
/* The list in the danger zone carries a button, which the Learning one does not - so the
   numbers get less room here and must not wrap. */
.danger .courses li { gap: 10px; }
.danger .cnum { min-width: 64px; }
.facts + .facts, .courses + .facts { margin-top: 18px; }
.facts .err { margin: 8px 0 0; }
hr { border: 0; border-top: 1px solid var(--ice-border); margin: 20px 0 16px; }

/* Separated by a gap and a colour, not by a heading alone - it is the last thing on the
   page and it should read as a different kind of thing before it is read at all. */
.danger { margin-top: 34px; border-color: var(--ice-bad); }
.danger h3 { color: var(--ice-bad); }
</style>
