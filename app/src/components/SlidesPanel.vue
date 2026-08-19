<script setup>
/* The unit's deck, alongside the exercise rather than instead of it.
 *
 * An iframe, deliberately: a built Slidev deck is its own small site with its own router
 * and asset paths, and it is served from the same origin so the signed cookies that unlock
 * content unlock it too. Keyboard focus belongs to whichever of the two panes was last
 * clicked, which is the behaviour a mouse gives you for free.
 */
const props = defineProps({ src: String, label: String });
const emit = defineEmits(['close']);
</script>

<template>
  <aside class="slides">
    <div class="bar">
      <span class="label">{{ label }}</span>
      <a class="link" :href="src" target="_blank" rel="noopener">Open in a tab</a>
      <button class="link" @click="emit('close')">Close</button>
    </div>
    <iframe :src="src" :title="`Slides for ${label}`"></iframe>
  </aside>
</template>

<style scoped>
.slides { display: flex; flex-direction: column; min-width: 0;
          border-left: 1px solid var(--ice-border); background: var(--ice-bg-soft); }
.bar { display: flex; align-items: center; gap: 14px; padding: 0 12px;
       border-bottom: 1px solid var(--ice-border); }
.label { font-size: 12px; padding: 9px 0; margin-right: auto; color: var(--ice-fg-muted);
         overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
iframe { flex: 1; width: 100%; border: 0; min-height: 0; background: #fff; }
</style>
