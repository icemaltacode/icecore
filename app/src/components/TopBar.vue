<script setup>
/* The bar across the top of every signed-in screen.
 *
 * It exists so the identity of the product and of the person using it sit in one fixed
 * place, rather than being repeated by whatever screen happens to be showing - the grid
 * and the sidebar each grew their own copy of the brand and their own sign-out before
 * this.
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { theme, resolved, CHOICES } from '../theme.js';

const props = defineProps({
  name: String,
  email: String,
  admin: Boolean,
  authed: Boolean,
});
defineEmits(['home', 'admin', 'signout']);

/* Falls back through name, then the local part of the email, then nothing.
 *
 * A backstop rather than the normal path: the pool declares `name` required, so the invite
 * Lambda always writes one - the local part itself when the admin typed no name. Defaulting
 * it to the whole address there instead is what makes this second fallback dead code and
 * puts a full email address in the corner of every page. Kept because a token predating that
 * fix, or any future writer that forgets, should degrade quietly rather than blankly. */
const label = computed(() => props.name || props.email?.split('@')[0] || '');
const initials = computed(() => {
  const words = label.value.split(/[\s._-]+/).filter(Boolean);
  return (words.slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
});

/* The theme picker. The button shows what is in force, not what was chosen, so a student
 * on System can see which way it went without opening anything. */
const GLYPH = { light: '☀', dark: '☾' };
const menu = ref(false);
const wrap = ref(null);
const away = e => { if (!wrap.value?.contains(e.target)) menu.value = false; };
onMounted(() => addEventListener('pointerdown', away));
onBeforeUnmount(() => removeEventListener('pointerdown', away));
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

      <div ref="wrap" class="theme" @keydown.esc="menu = false">
        <button class="pick" :title="`Theme: ${theme}`" :aria-expanded="menu"
                @click="menu = !menu">{{ GLYPH[resolved] }}</button>
        <ul v-if="menu" class="menu">
          <li v-for="c in CHOICES" :key="c.value">
            <button :class="{ on: theme === c.value }"
                    @click="theme = c.value; menu = false">
              <span class="tick">{{ theme === c.value ? '✓' : '' }}</span>{{ c.label }}
            </button>
          </li>
        </ul>
      </div>
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
          place-items: center; font-size: 11px; font-weight: 600; color: var(--ice-on-primary);
          background: var(--ice-primary); }
.name { font-size: 13px; max-width: 180px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.theme { position: relative; display: flex; }
.pick { width: 30px; height: 30px; display: grid; place-items: center; cursor: pointer;
        background: var(--ice-bg); border: 1px solid var(--ice-border); border-radius: 8px;
        color: var(--ice-fg-muted); font-size: 14px; line-height: 1; }
.pick:hover { color: var(--ice-fg); border-color: var(--ice-primary-soft); }
.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; margin: 0;
        padding: 4px; list-style: none; min-width: 140px;
        background: var(--ice-bg-soft); border: 1px solid var(--ice-border);
        border-radius: 8px; box-shadow: 0 8px 24px var(--ice-scrim); }
.menu button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
               padding: 7px 8px; border: 0; border-radius: 6px; background: none;
               cursor: pointer; font: inherit; font-size: 13px; color: var(--ice-fg); }
.menu button:hover { background: var(--ice-raise-strong); }
.menu button.on { color: var(--ice-primary-strong); }
.tick { width: 12px; font-size: 11px; }

/* Below a certain width the name is the first thing worth losing - the avatar still says
   who is signed in, and the actions still work. */
@media (max-width: 720px) {
  .name { display: none; }
}
</style>
