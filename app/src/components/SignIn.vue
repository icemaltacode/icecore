<script setup>
import Wordmark from './Wordmark.vue';
import { ref, nextTick } from 'vue';
import { signIn, completeNewPassword } from '../auth.js';

const emit = defineEmits(['authenticated']);

const email = ref('');
const password = ref('');
const newPassword = ref('');
const confirm = ref('');
const stage = ref('signin');   // 'signin' | 'newpassword'
const error = ref('');
const busy = ref(false);

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
</script>

<template>
  <div class="gate">
    <form class="card" @submit.prevent="stage === 'signin' ? submit() : setPassword()">
      <div class="brand">
        <Wordmark :size="30" />
      </div>

      <template v-if="stage === 'signin'">
        <h1>Sign in</h1>
        <p class="muted">Use the email address your course invitation was sent to.</p>

        <label for="email">Email</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required autofocus>

        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required>
      </template>

      <template v-else>
        <h1>Choose a password</h1>
        <p class="muted">Your invitation password was temporary. Pick one to keep — at least
          12 characters, with a number.</p>

        <label for="new-password">New password</label>
        <input id="new-password" v-model="newPassword" type="password" autocomplete="new-password" required>

        <label for="confirm">Confirm it</label>
        <input id="confirm" v-model="confirm" type="password" autocomplete="new-password" required>
      </template>

      <p v-if="error" class="err">{{ error }}</p>

      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? 'Just a moment…' : (stage === 'signin' ? 'Sign in' : 'Save and continue') }}
      </button>
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
.btn { margin-top: 4px; }
</style>
