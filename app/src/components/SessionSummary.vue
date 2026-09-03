<script setup>
/* What just happened, once the lesson has ended. Mock screen 11.
 *
 * THE BOOKMARK IS FIRST AND IT IS THE ONLY ACCENTED THING ON THE SCREEN, because it is the
 * only part of this that CHANGES anything: next Tuesday opens there. Everything below it is
 * a record, and a record laid out with the same weight as an action is one where nobody can
 * tell which is which.
 *
 * FOUR QUESTIONS AND IT STOPS. Where the next session opens, what was covered, who was here,
 * and what to fix. A summary that answers everything somebody might ask is one nobody reads,
 * and every extra panel here competes with the one line that matters.
 *
 * It is a read of a row that has already been written, handed back with the ending itself -
 * so this component fetches nothing and cannot be half-loaded.
 */
import Icon from './Icon.vue';

defineProps({
  /** The digest the Lambda built: mark, minutes, covered, people, said, worst. */
  summary: Object,
  cohortTitle: String,
  courseTitle: String,
});
defineEmits(['done']);

const clock = m => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const when = at => {
  const d = new Date(at);
  return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
</script>

<template>
  <div class="ended">
    <div class="sheet">
      <header>
        <h2>Session ended</h2>
        <p class="sub">{{ cohortTitle }}<template v-if="courseTitle"> · {{ courseTitle }}</template>
          <template v-if="summary?.minutes"> · {{ clock(summary.minutes) }}</template></p>
      </header>

      <!-- First, accented, and stated as a consequence rather than as a fact: "the bookmark
           is X" is a database row, "next time you will open here" is what it means. -->
      <section class="bookmark" :class="{ none: !summary?.mark }">
        <Icon name="pin" :size="16" />
        <div v-if="summary?.mark">
          <strong>Next time, this class opens on {{ summary.mark.title || summary.mark.exercise }}.</strong>
          <em>Their own progress is untouched — anyone who ran ahead keeps where they got to.</em>
        </div>
        <div v-else>
          <strong>No bookmark was saved.</strong>
          <em>The class will resume where it did before. That happens when a session ends
            without the player knowing where it was.</em>
        </div>
      </section>

      <div class="cols">
        <section>
          <h3>Covered</h3>
          <ol v-if="summary?.covered?.length" class="covered">
            <li v-for="c in summary.covered" :key="c.exercise">{{ c.title || c.exercise }}</li>
          </ol>
          <p v-else class="none">Nothing was walked through — the session ended where it
            started.</p>
        </section>

        <section>
          <h3>Attended <span class="n" v-if="summary?.people?.length">{{ summary.people.length }}</span></h3>
          <ul v-if="summary?.people?.length" class="people">
            <li v-for="p in summary.people" :key="p.sub">
              <span class="nm">{{ p.name || '—' }}</span>
              <!-- Joined-at as well as how long, because "20m" of a 50m lesson reads very
                   differently depending on which twenty. -->
              <span class="mins">{{ clock(p.minutes) }}<em v-if="p.first"> from {{ when(p.first) }}</em></span>
            </li>
          </ul>
          <p v-else class="none">Nobody connected.</p>
        </section>
      </div>

      <!-- Ordered by what went WRONG rather than by attempts: an exercise everybody tried
           once and got is not the one to look at. -->
      <section v-if="summary?.worst?.length">
        <h3>Hardest going</h3>
        <ul class="worst">
          <li v-for="w in summary.worst" :key="w.exercise">
            <span class="nm">{{ w.title || w.exercise }}</span>
            <span class="tally">
              <em class="bad">{{ w.wrong }} wrong</em>
              <em v-if="w.err" class="bad">{{ w.err }} could not run</em>
              <em class="good">{{ w.right }} got it</em>
            </span>
          </li>
        </ul>
      </section>

      <p v-if="summary?.said" class="said">{{ summary.said }}
        {{ summary.said === 1 ? 'message was' : 'messages were' }} sent. Chat is not kept.</p>

      <div class="acts">
        <button class="btn primary" type="button" @click="$emit('done')">Done</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* `ended` is unique across the app - Vue's scoped CSS reaches a child component's root. */
.ended { overflow: auto; padding: 40px 20px; display: flex; justify-content: center;
         background: var(--ice-bg); }
.sheet { width: min(720px, 100%); }
header { margin-bottom: 22px; }
h2 { margin: 0 0 4px; font-size: 22px; }
.sub { margin: 0; font-size: 13px; color: var(--ice-fg-muted); }

.bookmark { display: flex; gap: 12px; align-items: flex-start; padding: 16px;
            border-radius: 12px; background: var(--ice-primary-soft);
            border: 1px solid var(--ice-primary); margin-bottom: 26px; }
.bookmark.none { background: var(--ice-bg-soft); border-color: var(--ice-border); }
.bookmark strong { display: block; font-size: 15px; font-weight: 600; line-height: 1.45; }
.bookmark em { display: block; margin-top: 4px; font-style: normal; font-size: 12.5px;
               color: var(--ice-fg-muted); line-height: 1.5; }

.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
@media (max-width: 620px) { .cols { grid-template-columns: 1fr; } }
section { margin-bottom: 24px; }
h3 { margin: 0 0 10px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
     color: var(--ice-fg-muted); font-family: var(--ice-font-mono); font-weight: 600; }
h3 .n { margin-left: 6px; letter-spacing: 0; }
.none { margin: 0; font-size: 13px; color: var(--ice-fg-muted); line-height: 1.5; }

.covered, .people, .worst { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.covered { counter-reset: step; }
.covered li { padding: 5px 0 5px 26px; position: relative; line-height: 1.45;
              border-bottom: 1px solid var(--ice-border); }
.covered li:last-child { border-bottom: 0; }
.covered li:before { counter-increment: step; content: counter(step);
                     position: absolute; left: 0; top: 5px; width: 18px; text-align: right;
                     font-family: var(--ice-font-mono); font-size: 11px;
                     color: var(--ice-fg-muted); }

.people li, .worst li { display: flex; align-items: baseline; gap: 10px; padding: 5px 0;
                        border-bottom: 1px solid var(--ice-border); }
.people li:last-child, .worst li:last-child { border-bottom: 0; }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mins { flex: none; font-size: 12px; color: var(--ice-fg-muted);
        font-variant-numeric: tabular-nums; }
.mins em { font-style: normal; }
.tally { flex: none; display: flex; gap: 10px; font-size: 11.5px; }
.tally em { font-style: normal; }
.tally .bad { color: var(--ice-bad); }
.tally .good { color: var(--ice-good); }

.said { margin: 0 0 24px; font-size: 12.5px; color: var(--ice-fg-muted); }
.acts { display: flex; justify-content: flex-end; }
</style>
