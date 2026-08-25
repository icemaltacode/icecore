<script setup>
/* Which language, asked on the way in.
 *
 * The switch in the header is correct and almost invisible - a two-item segmented control
 * in the top-right of a screen whose interesting parts are all elsewhere. A student who
 * never notices it uses half the Playground and has no reason to suspect the other half
 * exists. So the choice is made in front of them once, on the way in, where it cannot be
 * missed; the header switch stays for changing your mind afterwards.
 *
 * ASKED EVERY TIME THE PLAYGROUND IS OPENED, not once ever. Opening a sandbox is a
 * deliberate act and "which of these am I doing today" is a fair question at that moment -
 * unlike a first-run tip, which is exactly the kind of thing people dismiss without reading
 * and then never see again. It is cheap to answer and cheaper to skip: Escape, the
 * backdrop, or Enter take the remembered choice.
 *
 * WHAT IT SAYS ABOUT EACH SIDE IS DERIVED, never written down here - set counts, file
 * counts and megabytes all come from the manifest, and the megabytes come from the bucket
 * by way of the publish step. A hard-coded "about 20MB" is a number that goes stale
 * silently, and this is the screen where being wrong would matter most.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({
  /** Only what the player can actually run - see RUNNABLE in Playground.vue. */
  languages: { type: Array, required: true },
  manifest: { type: Object, required: true },
  /** What they chose last time, pre-selected so Enter is always a sensible answer. */
  current: String,
});
const emit = defineEmits(['choose', 'close']);

const COPY = {
  sql: {
    title: 'SQL',
    line: 'A real Postgres database, running in this tab.',
    body: 'Load a set of tables, then query them. Sets stack, so you can hold two and join across them.',
  },
  python: {
    title: 'Python',
    line: 'pandas, matplotlib and the rest, running in this tab.',
    body: 'Data files land beside your code, ready to read by name. Plots appear under the output.',
  },
};

const sets = lang => props.manifest?.[lang]?.sets || [];
const refs = lang => sets(lang).flatMap(s => [...(s.datasets || []), ...(s.files || [])]);

/* Bytes only when the publish stamped them - a dev build never visits a bucket, and the
 * honest answer there is to say nothing rather than to say zero. */
const bytes = lang => refs(lang).reduce((n, r) => (r.bytes ? n + r.bytes : n), 0);
const human = n => (n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.round(n / 1024)} KB`);

const facts = lang => {
  const out = [`${sets(lang).length} set${sets(lang).length === 1 ? '' : 's'}`];
  const n = refs(lang).length;
  out.push(lang === 'sql'
    ? `${n} dataset${n === 1 ? '' : 's'}`
    : `${n} file${n === 1 ? '' : 's'}`);
  const b = bytes(lang);
  if (b) out.push(human(b));
  return out;
};

/* Keyboard, because this is a two-option question and reaching for the mouse to answer it
 * is the sort of friction that makes a modal feel like an obstacle. */
const at = ref(Math.max(0, props.languages.indexOf(props.current)));
const move = d => {
  at.value = (at.value + d + props.languages.length) % props.languages.length;
};
const key = e => {
  if (e.key === 'Escape') return emit('close');
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { move(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
  else if (e.key === 'Enter') { emit('choose', props.languages[at.value]); e.preventDefault(); }
};
onMounted(() => addEventListener('keydown', key));
onBeforeUnmount(() => removeEventListener('keydown', key));

const only = computed(() => props.languages.length === 1);
</script>

<template>
  <div class="pgstart" @click.self="emit('close')">
    <div class="sheet" role="dialog" aria-label="Choose a language">
      <div class="head">
        <h2>The Playground</h2>
        <p>No syllabus, no marking. Pick something to work in - you can switch whenever you
          like.</p>
      </div>

      <div class="choices" :class="{ one: only }">
        <button v-for="(lang, i) in languages" :key="lang" class="choice"
                :class="{ at: i === at, was: lang === current }"
                @mouseenter="at = i"
                @click="emit('choose', lang)">
          <span class="mark">{{ COPY[lang].title }}</span>
          <strong>{{ COPY[lang].line }}</strong>
          <small>{{ COPY[lang].body }}</small>
          <!-- Derived, every one of them. See the note at the top of this file. -->
          <span class="facts">
            <span v-for="f in facts(lang)" :key="f">{{ f }}</span>
          </span>
          <span class="go"><Icon name="run" :size="13" /></span>
        </button>
      </div>

      <button class="skip" @click="emit('close')">
        {{ current ? `Carry on with ${COPY[current].title}` : 'Just take me in' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Unique root class throughout: Vue's scoped CSS reaches a child component's root, and this
   one renders an Icon inside every card. */
.pgstart { position: fixed; inset: 0; background: var(--ice-scrim); z-index: 60;
           display: grid; place-items: center; padding: 5vh 20px; }
.sheet { width: min(760px, 100%); background: var(--ice-bg-soft);
         border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
         padding: 30px 30px 22px; box-shadow: 0 18px 60px var(--ice-scrim); }
.head h2 { margin: 0 0 6px; font-size: 21px; }
.head p { margin: 0 0 22px; color: var(--ice-fg-muted); font-size: 13.5px; max-width: 52ch;
          line-height: 1.6; }

.choices { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
.choices.one { grid-template-columns: 1fr; }
/* Below this the two cards stop being comparable side by side and become two very narrow
   columns of prose. */
@media (max-width: 620px) { .choices { grid-template-columns: 1fr; } }

.choice { position: relative; display: flex; flex-direction: column; gap: 5px;
          text-align: left; padding: 20px 18px 18px; cursor: pointer; font: inherit;
          color: var(--ice-fg); background: var(--ice-bg);
          border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
          transition: border-color .12s, transform .12s, box-shadow .12s; }
/* One highlight, driven by `at`, which the pointer and the arrow keys both set - so hover
   and keyboard cannot disagree about which card is the one Enter would pick. */
.choice.at { border-color: var(--ice-primary); transform: translateY(-2px);
             box-shadow: 0 6px 22px var(--ice-scrim); }

/* The wordmark of the language, in the accent. It is the thing the eye lands on, and the
   only reason the card is scannable at a glance. */
.mark { font-family: var(--ice-font-mono); font-size: 26px; font-weight: 600;
        letter-spacing: -.02em; line-height: 1; color: var(--ice-mark); margin-bottom: 8px; }
.choice strong { font-size: 14px; line-height: 1.4; }
.choice small { color: var(--ice-fg-muted); font-size: 12px; line-height: 1.55; }

.facts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.facts span { font-family: var(--ice-font-mono); font-size: 9.5px; letter-spacing: .04em;
              text-transform: uppercase; color: var(--ice-fg-muted);
              background: var(--ice-raise-strong); border-radius: 5px; padding: 3px 7px; }

/* Shows where the card is going, and only on the one that is about to go there. */
.go { position: absolute; top: 18px; right: 16px; opacity: 0; color: var(--ice-primary);
      transition: opacity .12s; }
.choice.at .go { opacity: 1; }

.skip { display: block; margin: 20px auto 0; padding: 6px 12px; font: inherit; font-size: 12px;
        cursor: pointer; background: none; border: 0; border-radius: 8px;
        color: var(--ice-fg-muted); }
.skip:hover { color: var(--ice-fg); background: var(--ice-raise); }
</style>
