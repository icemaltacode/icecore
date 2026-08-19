<script setup>
import { ref, watch } from 'vue';
import { api } from '../auth.js';

const props = defineProps({ courses: Array });
const emit = defineEmits(['close']);

const course = ref(props.courses?.[0]?.id || '');
const email = ref('');
const name = ref('');
const users = ref([]);
const busy = ref(false);
const error = ref('');
const notice = ref('');

async function refresh() {
  if (!course.value) return;
  error.value = '';
  try {
    const r = await api(`admin/enrolments?course=${encodeURIComponent(course.value)}`);
    users.value = r.users;
  } catch (e) { error.value = e.message; }
}
watch(course, refresh, { immediate: true });

async function add() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const r = await api('admin/enrolments', {
      method: 'POST',
      body: { email: email.value.trim(), name: name.value.trim() || undefined, course: course.value },
    });
    notice.value = r.invited
      ? `Invitation sent to ${email.value.trim()}.`
      : `${email.value.trim()} was already registered, and is now on this course.`;
    email.value = ''; name.value = '';
    await refresh();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function remove(user) {
  if (!confirm(`Take ${user.email} off this course? Their account and progress stay.`)) return;
  error.value = ''; notice.value = '';
  try {
    await api(`admin/enrolments?sub=${encodeURIComponent(user.sub)}&course=${encodeURIComponent(course.value)}`,
      { method: 'DELETE' });
    await refresh();
  } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div class="admin">
    <div class="card">
      <header>
        <h2>Course enrolment</h2>
        <button class="btn ghost" @click="emit('close')">Back to practising</button>
      </header>
      <p class="muted">Inviting someone who has no account creates one and emails them a
        temporary password. There is no progress reporting here yet.</p>

      <label for="course">Course</label>
      <select id="course" v-model="course">
        <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.topic }} — {{ c.title }}</option>
      </select>

      <form class="add" @submit.prevent="add">
        <div>
          <label for="email">Email</label>
          <input id="email" v-model="email" type="email" required placeholder="student@example.com">
        </div>
        <div>
          <label for="name">Name <span class="opt">optional</span></label>
          <input id="name" v-model="name" type="text" placeholder="Jane Borg">
        </div>
        <button class="btn primary" type="submit" :disabled="busy || !course">Invite &amp; enrol</button>
      </form>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="notice" class="ok">{{ notice }}</p>

      <h3>On this course <span class="count">{{ users.length }}</span></h3>
      <ul class="people">
        <li v-for="u in users" :key="u.sub">
          <span class="who">
            <strong>{{ u.name || u.email }}</strong>
            <small v-if="u.name">{{ u.email }}</small>
          </span>
          <button class="link" @click="remove(u)">Remove</button>
        </li>
        <li v-if="!users.length" class="none">Nobody yet.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.admin { overflow: auto; padding: 40px; display: flex; justify-content: center; }
.card { width: min(720px, 100%); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 22px; }
.muted { color: var(--ice-fg-muted); font-size: 13px; margin: 8px 0 24px; }
label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
        color: var(--ice-fg-muted); margin-bottom: 6px; }
.opt { text-transform: none; letter-spacing: 0; opacity: .7; }
select, input { width: 100%; font: inherit; font-size: 14px; padding: 9px 11px;
                background: var(--ice-bg); color: var(--ice-fg);
                border: 1px solid var(--ice-border); border-radius: 8px; }
select:focus, input:focus { outline: none; border-color: var(--ice-primary); }
.add { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; margin-top: 20px; }
.add .btn { height: 38px; }
.err { color: #fca5a5; font-size: 13px; }
.ok { color: #86efac; font-size: 13px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--ice-fg-muted); margin: 32px 0 10px; }
.count { background: var(--ice-bg-soft); border: 1px solid var(--ice-border); border-radius: 5px;
         padding: 1px 6px; margin-left: 6px; }
.people { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.people li { display: flex; align-items: center; justify-content: space-between; gap: 12px;
             padding: 12px 14px; background: var(--ice-bg-soft);
             border: 1px solid var(--ice-border); border-radius: var(--ice-radius); font-size: 14px; }
.who small { display: block; color: var(--ice-fg-muted); font-size: 12px; }
.people li.none { color: var(--ice-fg-muted); justify-content: flex-start; }
@media (max-width: 640px) { .add { grid-template-columns: 1fr; } }
</style>
