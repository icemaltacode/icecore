<script setup>
/* The bar across the top of every signed-in screen.
 *
 * It exists so the identity of the product and of the person using it sit in one fixed
 * place, rather than being repeated by whatever screen happens to be showing - the grid
 * and the sidebar each grew their own copy of the brand and their own sign-out before
 * this.
 */
import { computed } from 'vue';

const props = defineProps({
  name: String,
  email: String,
  admin: Boolean,
  authed: Boolean,
});
defineEmits(['home', 'admin', 'signout']);

/* Falls back through name, then the local part of the email, then nothing: an invitation
 * always carries an email and only sometimes carries a name. */
const label = computed(() => props.name || props.email?.split('@')[0] || '');
const initials = computed(() => {
  const words = label.value.split(/[\s._-]+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
});
</script>

<template>
  <header class="topbar">
    <!-- Placeholder for the logo. Keep it a button: it is the way home from anywhere. -->
    <button class="mark" @click="$emit('home')">
      <span class="dot"></span>
      <strong>ICE Practice</strong>
    </button>

    <div class="right">
      <button v-if="admin" class="btn ghost" @click="$emit('admin')">Manage enrolment</button>
      <div v-if="label" class="who">
        <span class="avatar">{{ initials }}</span>
        <span class="name">{{ label }}</span>
      </div>
      <button v-if="authed" class="btn ghost" @click="$emit('signout')">Sign out</button>
    </div>
  </header>
</template>

<style scoped>
/* Not `.bar`: a parent's scoped styles also apply to a child component's root element, and
   App.vue has a `.bar` for the progress meter. That collision put a 999px radius on the
   corners of the top bar and would have kept finding new ways to be wrong. */
.topbar { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 52px;
          background: var(--ice-bg-soft); border-bottom: 1px solid var(--ice-border); }
.mark { display: flex; align-items: center; gap: 10px; background: none; border: 0;
        padding: 6px 8px; margin-left: -8px; border-radius: 8px; cursor: pointer;
        color: var(--ice-fg); font: inherit; }
.mark:hover { background: var(--ice-bg); }
.dot { width: 14px; height: 14px; border-radius: 4px; background: var(--ice-primary); flex: none; }

.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.who { display: flex; align-items: center; gap: 8px; padding-left: 4px; }
.avatar { width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid;
          place-items: center; font-size: 11px; font-weight: 600; color: #06121e;
          background: var(--ice-primary); }
.name { font-size: 13px; max-width: 180px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Below a certain width the name is the first thing worth losing - the avatar still says
   who is signed in, and the actions still work. */
@media (max-width: 720px) {
  .name { display: none; }
}
</style>
