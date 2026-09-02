<script setup>
/* You are looking at somebody else's session.
 *
 * The single most important thing on the screen while it is up. Everything below it is the
 * ordinary player - the same grid, the same exercises, the same editor - so without a
 * standing, unmissable statement of whose it is, an admin has no way to tell a student's
 * progress from their own. That failure is quiet and it is the wrong way round: mistaking
 * your own work for someone else's is confusing, mistaking theirs for yours is worse.
 *
 * So it is persistent rather than a toast, it names the person, and it says what is and is
 * not happening - read-only is the reassurance that makes it safe to look.
 */
defineProps({ name: String, email: String });
defineEmits(['exit']);
</script>

<template>
  <div class="watch" role="status">
    <span class="dot" aria-hidden="true"></span>
    <span class="what">
      Viewing <strong>{{ name || email }}</strong>'s session — read-only.
      <span class="sub">Nothing you do here is recorded against them.</span>
    </span>
    <button class="btn" @click="$emit('exit')">Back to admin</button>
  </div>
</template>

<style scoped>
/* Not the danger colour. Nothing is wrong and nothing is at risk - this is a statement of
   where you are, and a red bar across the top of every page reads as an alarm that cannot
   be dismissed. Amber against the page rather than against the theme, so it stays the one
   band on screen that is not part of the product's own palette. */
.watch { display: flex; align-items: center; gap: 12px; padding: 8px 16px;
         background: var(--ice-primary-soft); color: var(--ice-fg);
         border-bottom: 1px solid var(--ice-primary-soft); font-size: 13px; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%;
       background: var(--ice-primary); }
/* It pulses, because a band that never changes stops being read after ten minutes and this
   one has to survive being looked past. Slow enough not to nag. */
@media (prefers-reduced-motion: no-preference) {
  .dot { animation: pulse 2.4s ease-in-out infinite; }
}
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.what { flex: 1; min-width: 0; }
.what strong { font-weight: 600; }
.sub { color: var(--ice-fg-muted); }
@media (max-width: 640px) { .sub { display: none; } }
</style>
