<script setup>
/* Somebody said something, and you are not looking at the chat.
 *
 * A BADGE SAYS THAT SOMETHING WAS SAID; IT DOES NOT SAY WHAT. That is the whole reason this
 * exists: a student mid-exercise will not open a panel to find out, and being spoken to
 * during a lesson is the one thing on this screen that might actually need answering. So it
 * gets a sentence.
 *
 * It is a popup rather than a band, which is the opposite call from the invitation - and the
 * difference is that a lesson starting stays true until you join it, where a message is a
 * moment. A band that could not be dismissed for every message would be a wall of them.
 *
 * The whole thing is the button. A popup with a small "open" link in it asks somebody to aim
 * at a target while reading, and the only two things anyone wants here are "show me" and "go
 * away" - which is the card and the ×.
 */
import Icon from './Icon.vue';

defineProps({ message: Object });
defineEmits(['open', 'close']);

const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
</script>

<template>
  <div class="saidtoast" role="status">
    <button class="body" type="button" @click="$emit('open')">
      <span class="avatar" :class="{ lead: message?.role === 'tutor' }">
        {{ initials(message?.from) }}
      </span>
      <span class="text">
        <strong>{{ message?.from || 'Somebody' }}<em v-if="message?.role === 'tutor'">Educator</em></strong>
        <!-- Clamped rather than truncated with an ellipsis in JS: two lines of a long message
             is enough to know whether it is for you, and the rest is one click away. -->
        <span class="line">{{ message?.text }}</span>
      </span>
      <Icon name="chat" :size="15" />
    </button>
    <button class="x" type="button" title="Dismiss" @click="$emit('close')">×</button>
  </div>
</template>

<style scoped>
/* Unique root class, like every other component here - Vue's scoped CSS reaches a child's
   root element and `toast` is the kind of name something else will want. */
.saidtoast { position: fixed; right: 20px; bottom: 20px; z-index: 70;
             width: min(340px, calc(100vw - 40px)); display: flex; align-items: flex-start;
             background: var(--ice-bg); border: 1px solid var(--ice-border);
             border-radius: 12px; box-shadow: 0 12px 36px rgb(0 0 0 / .22);
             overflow: hidden; }
@media (prefers-reduced-motion: no-preference) {
  .saidtoast { animation: rise .18s ease-out; }
}
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }

.body { flex: 1; min-width: 0; display: flex; gap: 9px; align-items: flex-start;
        padding: 11px 4px 11px 12px; text-align: left; font: inherit; cursor: pointer;
        background: none; border: 0; color: var(--ice-fg); }
.body:hover { background: var(--ice-bg-soft); }
.avatar { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; background: var(--ice-primary-soft);
          color: var(--ice-primary-strong); font-size: 9.5px; font-weight: 600; line-height: 1; }
.avatar.lead { background: var(--ice-primary); color: var(--ice-on-primary); }
.text { flex: 1; min-width: 0; }
.text strong { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px;
               font-weight: 600; }
.text em { font-style: normal; font-size: 9.5px; letter-spacing: .06em;
           text-transform: uppercase; font-family: var(--ice-font-mono);
           color: var(--ice-primary-strong); }
.line { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; margin-top: 2px; font-size: 13px; line-height: 1.4;
        overflow-wrap: anywhere; }
.body :deep(.icon) { flex: none; margin-top: 2px; color: var(--ice-fg-muted); }

.x { flex: none; width: 28px; align-self: stretch; cursor: pointer; font-size: 16px;
     line-height: 1; background: none; border: 0; color: var(--ice-fg-muted); }
.x:hover { color: var(--ice-fg); background: var(--ice-bg-soft); }
</style>
