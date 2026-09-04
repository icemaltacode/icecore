<script setup>
import Wordmark from './Wordmark.vue';
import { ref, nextTick } from 'vue';
import { signIn, completeNewPassword, forgotPassword, confirmPassword } from '../auth.js';

const emit = defineEmits(['authenticated']);

const email = ref('');
const password = ref('');
const newPassword = ref('');
const confirm = ref('');
const code = ref('');
/* 'signin' and 'newpassword' are the two the invitation walks through; 'forgot' and 'reset'
 * are recovery, and they are on THIS card rather than on a screen of their own because the
 * person using them cannot get past this one. */
const stage = ref('signin');   // 'signin' | 'newpassword' | 'forgot' | 'reset'
const error = ref('');
/* Kept apart from `error`. Both are one line under the fields, and both were `error` at
 * first - which meant "a code is on its way" arrived in red as though something had gone
 * wrong. */
const notice = ref('');
const busy = ref(false);

const TITLES = {
  signin: 'Sign in',
  newpassword: 'Choose a password',
  forgot: 'Reset your password',
  reset: 'Check your email',
};
const ACTIONS = {
  signin: 'Sign in',
  newpassword: 'Save and continue',
  forgot: 'Send me a code',
  reset: 'Set my password',
};

/** Move between stages without carrying the last one's message with you. */
function to(next) {
  stage.value = next;
  error.value = '';
  notice.value = '';
}

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const r = await signIn(email.value.trim(), password.value);
    if (r?.challenge === 'NEW_PASSWORD') {
      stage.value = 'newpassword';
      await nextTick();
      document.getElementById('new-password')?.focus();
    } else {
      emit('authenticated', r);
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function setPassword() {
  error.value = '';
  if (newPassword.value !== confirm.value) { error.value = 'Those two passwords do not match.'; return; }
  busy.value = true;
  try {
    emit('authenticated', await completeNewPassword(newPassword.value));
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

/**
 * Ask for a code.
 *
 * `resend` distinguishes the two ways in - the first time it advances the stage, and from
 * the reset screen it stays put and says so. Without the second, a code that never arrives
 * is a dead end: the only way back is to reload the page.
 */
async function sendCode(resend = false) {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    await forgotPassword(email.value.trim());
    /* CONDITIONAL ON PURPOSE. The client sets preventUserExistenceErrors, so Cognito
     * answers an address with no account exactly as it answers one with an account - which
     * is what stops this screen being a way to test who has an account here. Promising a
     * code outright would be a promise we cannot keep for a student who mistyped. */
    notice.value = 'If that address has an account, a six-digit code is on its way to it.';
    if (!resend) { stage.value = 'reset'; await nextTick(); document.getElementById('code')?.focus(); }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function resetPassword() {
  error.value = '';
  if (newPassword.value !== confirm.value) { error.value = 'Those two passwords do not match.'; return; }
  busy.value = true;
  try {
    await confirmPassword(email.value.trim(), code.value.trim(), newPassword.value);
    /* Straight in rather than back to the sign-in card. They have just proved they can read
     * that inbox and chosen the password themselves, so asking them to type it again adds a
     * step and no security at all. If that second call fails for any other reason, fall back
     * to signing in by hand rather than stranding them on a screen that has succeeded. */
    try {
      emit('authenticated', await signIn(email.value.trim(), newPassword.value));
    } catch {
      password.value = '';
      to('signin');
      notice.value = 'Your password is set. Sign in with it.';
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

const SUBMIT = { signin: submit, newpassword: setPassword, forgot: sendCode, reset: resetPassword };
</script>

<template>
  <div class="gate">
    <form class="card" @submit.prevent="SUBMIT[stage]()">
      <div class="brand">
        <Wordmark :size="30" />
      </div>

      <h1>{{ TITLES[stage] }}</h1>

      <template v-if="stage === 'signin'">
        <p class="muted">Use the email address your course invitation was sent to.</p>

        <label for="email">Email</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required autofocus>

        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required>
        <!-- UNDER the field rather than beside its label. Both put it next to the thing it
             is about; this one puts it after the attempt rather than before it, which is the
             order the person reaching for it actually goes in - they type a password first
             and look for this when it does not work. -->
        <div class="forgot">
          <button type="button" class="link" @click="to('forgot')">Forgot it?</button>
        </div>
      </template>

      <template v-else-if="stage === 'newpassword'">
        <p class="muted">Your invitation password was temporary. Pick one to keep — at least
          12 characters, with a number.</p>

        <label for="new-password">New password</label>
        <input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" required>

        <label for="confirm">Confirm it</label>
        <input id="confirm" v-model="confirm" type="password" autocomplete="new-password" required>
      </template>

      <template v-else-if="stage === 'forgot'">
        <p class="muted">We'll email you a six-digit code to set a new one with.</p>

        <label for="forgot-email">Email</label>
        <input id="forgot-email" v-model="email" type="email" autocomplete="username" required autofocus>
      </template>

      <template v-else>
        <p class="muted">Enter the code we sent, and the password you'd like instead — at
          least 12 characters, with a number.</p>

        <label for="code">Code</label>
        <!-- one-time-code lets a phone offer it straight from the notification. -->
        <input id="code" v-model="code" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" required>

        <label for="reset-password">New password</label>
        <input id="reset-password" v-model="newPassword" type="password" autocomplete="new-password" required>

        <label for="reset-confirm">Confirm it</label>
        <input id="reset-confirm" v-model="confirm" type="password" autocomplete="new-password" required>
      </template>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-else-if="notice" class="note">{{ notice }}</p>

      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? 'Just a moment…' : ACTIONS[stage] }}
      </button>

      <!-- A code that never arrives is otherwise a dead end whose only exit is a reload. -->
      <p v-if="stage === 'reset'" class="after">
        <button type="button" class="link" :disabled="busy" @click="sendCode(true)">Send another code</button>
      </p>
      <p v-if="stage === 'forgot' || stage === 'reset'" class="after">
        <button type="button" class="link" @click="to('signin')">Back to sign in</button>
      </p>
    </form>
  </div>
</template>

<style scoped>
.gate { height: 100vh; display: grid; place-items: center; padding: 24px; }
.card { width: min(380px, 100%); display: flex; flex-direction: column;
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
        border-radius: var(--ice-radius); padding: 28px; }
.brand { display: flex; align-items: center; margin-bottom: 22px; }
h1 { margin: 0 0 4px; font-size: 20px; }
.muted { color: var(--ice-fg-muted); font-size: 13px; margin: 0 0 18px; }
label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ice-fg-muted); margin-bottom: 6px; }
input { font: inherit; font-size: 14px; padding: 9px 11px; margin-bottom: 16px;
        background: var(--ice-bg); color: var(--ice-fg);
        border: 1px solid var(--ice-border); border-radius: 8px; }
input:focus { outline: none; border-color: var(--ice-primary); }
.err { color: var(--ice-bad); font-size: 13px; margin: 0 0 14px; }
/* Not red. "A code is on its way" is the flow working, and it sat in the error slot long
   enough to prove that colour is most of what gets read here. */
.note { color: var(--ice-fg-muted); font-size: 13px; margin: 0 0 14px; }
.btn { margin-top: 4px; }

/* The label and its escape hatch on one line, so the hatch is where the trouble is. */
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
/* Pulled up against the field above it and out of the label rhythm below: the inputs carry a
   bottom margin meant to separate one labelled field from the next, and the link is part of
   the field it sits under rather than a step of its own. */
.forgot { display: flex; justify-content: flex-end; margin: -6px 0 4px; }
.row label { margin-bottom: 6px; }

.link { background: none; border: 0; padding: 0; font: inherit; font-size: 12px;
        color: var(--ice-primary); cursor: pointer; }
.link:hover { text-decoration: underline; }
.link:disabled { color: var(--ice-fg-muted); cursor: default; text-decoration: none; }
.after { margin: 12px 0 0; text-align: center; }
.after + .after { margin-top: 8px; }
</style>
