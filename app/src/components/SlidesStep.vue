<script setup>
/* A topic's slides, as a step in the run rather than a panel beside it.
 *
 * The deck is one built Slidev site per UNIT, and every deck sets `routerMode: hash`, so a
 * topic is addressed by appending `#/<n>` and resolved entirely client-side. No CloudFront
 * rewrite, no redirect rules, nothing to deploy - which was the expected blocker for this
 * whole feature and turned out not to be one.
 *
 * The iframe is same-origin, so the signed cookies that unlock content unlock the deck too.
 * It is also why the student can page through the topic with the deck's own keyboard
 * shortcuts once they have clicked into it.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import DeckActions from './DeckActions.vue';
import SplitPane from './SplitPane.vue';
import Icon from './Icon.vue';
import { loadNotes } from '../content.js';
import { md } from '../md.js';

const emit = defineEmits(['slide']);
const props = defineProps({
  /* Which slide to be on, when something outside is driving - a live session following the
   * tutor. Undefined means nobody is driving, which is every other use of this component.
   *
   * A NUMBER RATHER THAN A HASH, because the range is the component's business: what
   * arrives is "the tutor is on 15" and what happens to it is the same clamp everything
   * else goes through. */
  goto: Number,
  /* `slides` off the topic - `slides/1.1/index.html`, its unit's deck, or an absolute URL
   * when a deck lives somewhere else entirely. */
  deck: String,
  row: Object,     // the walk row: title, slide, end
  courseId: String,
  /* How many of the topic's slides carry a note, off the topic in index.json. A count
   * rather than the notes themselves, so the button can be offered - or not - without a
   * request that might come back empty. */
  noteCount: Number,
});

const base = computed(() => (/^https?:\/\//.test(props.deck || '')
  ? props.deck
  : `${import.meta.env.BASE_URL}${props.deck}`));
/**
 * The frame's URL, or null when there is no deck to point it at.
 *
 * NULL RATHER THAN A URL BUILT OUT OF NOTHING, and this is the whole of a bug worth naming.
 * A missing `deck` used to compose `/undefined#/12` - a path the site answers with its own
 * `index.html`, because that is what an SPA fallback is for. So the iframe loaded the PLAYER,
 * and a student watching slides was shown the entire application nested inside the pane where
 * the deck belonged: a broken link rendered as a working page.
 *
 * It is the same rule `icecore dev` already enforces from the other side - a missing asset
 * must 404 rather than come back as the app's own index page - and this is where the site
 * itself cannot enforce it, so the component has to. Fail in the direction that shows.
 */
const src = computed(() =>
  (props.deck ? `${base.value}#/${props.row.slide}` : null));
const count = computed(() => (props.row.end - props.row.slide) + 1);
/* Numbered the way the deck's own paginator numbers it, because both are on screen at
 * once. The frame shows 13/31 - the COMPOSED deck, module frame and unit title included -
 * so a header reading "8 slides" is a second, correct, unrelated count of something else,
 * and the two together read as a fault. Falls back to the plain count for a course whose
 * build predates `slideCount`. */
const range = computed(() => props.row.total
  ? `${props.row.slide}\u2013${props.row.end} of ${props.row.total}`
  : `${count.value} slide${count.value === 1 ? '' : 's'}`);

/* THE SPEAKER NOTES, BESIDE THE SLIDE.
 *
 * Slidev keeps these for the presenter, and a student reading the deck on their own never
 * sees them - which is a waste here specifically, because the house rule is that a note is
 * a handout rather than a stage direction. They are written to be read by the person
 * looking at the slide.
 *
 * FOLLOWS THE FRAME, not the step. A slide step is a RANGE, and the student pages through
 * it inside the iframe, so the panel has to track where they actually are rather than where
 * the step began. The hash is the only thing that knows, and it is already being watched
 * for the clamp below - so the note follows for free rather than needing its own mechanism.
 *
 * FETCHED ON FIRST OPEN, not on mount. ~11KB for a unit is nothing, but a student who never
 * opens the panel should not pay for it on every slide step in the course. Notes are the
 * DECK's, so the file is a unit's and the cache is keyed by unit: walking the topics of one
 * unit remounts this component each time and must not re-fetch the same file. */
const NOTES_OPEN = 'ice-notes-open';
const NOTES_SIDE = 'ice-notes-side';
/* Right by default: on a wide window the stage is limited by HEIGHT, so the notes take
 * horizontal room the slide could not have used anyway. Narrow, that reverses - hence the
 * side being a choice rather than a constant, and remembered. */
const showNotes = ref(localStorage.getItem(NOTES_OPEN) === 'yes');
const side = ref(localStorage.getItem(NOTES_SIDE) === 'column' ? 'column' : 'row');
watch(showNotes, v => localStorage.setItem(NOTES_OPEN, v ? 'yes' : 'no'));
watch(side, v => localStorage.setItem(NOTES_SIDE, v));

const notes = ref(null);          // slide number -> markdown
const notesError = ref('');
const current = ref(props.row.slide);

const cache = new Map();
/* `1.1.3` -> `1.1`. The deck, and so the notes file, belongs to the topic's unit. */
const unitOf = topic => String(topic).split('.').slice(0, 2).join('.');
async function fetchNotes() {
  if (notes.value || !props.courseId || !props.row?.topicId) return;
  const unit = unitOf(props.row.topicId);
  const key = `${props.courseId}/${unit}`;
  if (!cache.has(key)) cache.set(key, loadNotes(props.courseId, unit));
  try { notes.value = await cache.get(key); }
  catch (e) {
    // A unit whose deck has no notes publishes no file. Not an error worth a red banner -
    // the panel just says there are none.
    cache.delete(key);
    notesError.value = String(e.message || e);
    notes.value = {};
  }
}
watch(showNotes, open => { if (open) fetchNotes(); });
onMounted(() => { if (showNotes.value) fetchNotes(); });
onUnmounted(() => stopDriving?.());

const note = computed(() => notes.value?.[current.value] || '');
const noteHtml = computed(() => (note.value ? md(note.value) : ''));

/* SHOW SLIDEV'S OWN CONTROL BAR.
 *
 * The deck already has everything: previous/next, slide overview, presenter mode with the
 * speaker notes, the drawing toolbar, fullscreen. Slidev just hides the bar behind
 * `opacity-0 hover:opacity-100`, which is right for a deck filling a screen and wrong
 * inside a frame, where a student has no reason to sweep the pointer into the corner to
 * discover it. So the only thing needed here is to stop it being invisible - not to
 * reimplement any of it.
 *
 * The frame is same-origin, so a stylesheet can simply be added to it. Structural selector
 * rather than the utility classes Slidev happens to compile (`.absolute.bottom-0`), because
 * those are an implementation detail and this should not need touching when they change. */
const frame = ref(null);
/* The driving watcher belongs to the FRAME, not to the component: the iframe is keyed on
 * `src`, so moving between topics of one deck builds a new element, and a watcher left over
 * from the last one would be writing hashes into a window that no longer exists. */
let stopDriving = null;

/* Two things, both injected into the frame rather than worked around from outside.
 *
 * 1. Reveal the bar, as above.
 * 2. Put it BELOW the slide instead of over it. Slidev centres the slide in its container
 *    (`top: 50%` plus a translate) and parks the controls at the container's bottom edge,
 *    so on a container the exact shape of the slide they necessarily overlap it. Pinning
 *    the slide to the top means any extra container height collects underneath, which is
 *    where the frame's extra `--bar` pixels go - and the bar lands in that strip.
 *
 * The container's background is a documented Slidev variable that defaults to black; made
 * transparent here so the strip shows the frame's own white rather than a black band. */
const REVEAL = `
.slidev-slide-container > div:has(nav .slidev-icon-btn) { opacity: 1 !important; }
.slidev-slide-container { background: transparent !important; }
.slidev-slide-content {
  top: 0 !important;
  left: 50% !important;
  margin-left: calc(-960px * var(--slidev-slide-scale)) !important;
  transform: scale(var(--slidev-slide-scale)) !important;
  transform-origin: 0 0 !important;
}`;

/* KEEP THE STUDENT INSIDE THE TOPIC.
 *
 * The deck is the whole UNIT - every topic of it - and Slidev's Next quite reasonably walks
 * the lot. That is wrong here: a slide step is ONE topic's range, and paging out of it
 * lands the student in the next topic's slides having skipped the exercises that practise
 * this one, which is the one thing the interleaving exists to prevent.
 *
 * HOOKED ON pushState, NOT ON hashchange. `routerMode: hash` is a vue-router hash history,
 * and vue-router hash mode still drives the History API: it calls `history.pushState` with
 * a `#/n` URL. No `hashchange` fires, and no `popstate` either - a listener on those sees
 * nothing at all while the deck pages happily past the end. (It is worth stating because
 * the first version of this did exactly that and looked correct.)
 *
 * Patching pushState catches every way out at once - the bar's arrows, arrow keys, space,
 * PageDown, a swipe, and clicking any slide in the overview - because all of them are the
 * router navigating. Guarding the keys instead would be wrong as well as incomplete:
 * ArrowRight on a v-click slide advances the CLICK, and blocking it on the topic's last
 * slide would strand the student mid-build.
 *
 * The push is allowed through and then undone with `back()`, rather than being blocked.
 * vue-router updates its own reactive location alongside the History call, so refusing to
 * delegate leaves the URL right and the rendered slide wrong; going back one entry moves
 * both. The cost is a frame of the next slide before it returns, which reads as the topic
 * ending rather than as a fault.
 *
 * The hash is `#/<slide>` or `#/<slide>/<click>`, so only the leading number is read - a
 * click within an in-range slide must not be disturbed. */
const onLoad = () => {
  const win = frame.value?.contentWindow;
  const doc = frame.value?.contentDocument;
  if (!doc || doc.getElementById('ice-reveal-controls')) return;
  const style = doc.createElement('style');
  style.id = 'ice-reveal-controls';
  style.textContent = REVEAL;
  doc.head.appendChild(style);

  const { slide: lo, end: hi } = props.row;
  const at = () => Number(/^#\/(\d+)/.exec(win.location.hash || '')?.[1]) || 0;
  /**
   * SEND THE FRAME TO A SLIDE, BY ABSOLUTE URL. This is not tidiness, it is the whole of
   * the bug that made an educator advancing a slide render the player inside the frame.
   *
   * `location.replace()` resolves a relative URL against the ENTRY settings object - the
   * realm of the script that called it - and the script calling it here is the PLAYER, not
   * the deck. So `win.location.replace('#/12')` composed the fragment onto the player's own
   * URL and navigated the iframe to `/?course=<id>#/12`, which the site answers with
   * `index.html`, because `/` is the distribution's default root object. The frame loaded
   * the application. Measured in Chromium rather than reasoned about: from a parent at
   * `/parent.html?course=c1#/live/a`, a frame on `/deck/index.html#/3` told to replace
   * `#/12` ends up on `/parent.html?course=c1#/12`, with the parent's title.
   *
   * That is the same SYMPTOM as the `/undefined#/12` bug fixed in 14ce371 and a completely
   * different cause, which is why fixing that one did not fix this - the src was right all
   * along and the navigation away from it was not.
   *
   * `win.location.hash = ...` would resolve correctly, since it only touches the fragment of
   * the location's own URL - but it pushes a history entry per slide, and following a tutor
   * through nine slides would make Back a slow walk backwards through the lesson. Reading
   * the frame's own href and handing back an absolute URL keeps `replace` and takes the
   * ambiguity out of it entirely.
   *
   * NOT COVERED BY `test/player.mjs`: jsdom resolves `replace()` against the frame's own
   * document, so the broken version passes there too. The only honest instrument is a
   * browser, and that is where this was both found and checked.
   */
  const goTo = n => {
    const u = new URL(win.location.href);
    u.hash = `#/${n}`;
    win.location.replace(u.href);
  };
  /* The notes panel rides on the clamp's hash watch rather than installing a second one.
   * Same reasoning as the clamp itself: vue-router hash mode drives pushState and fires no
   * hashchange, so anything watching the hash on its own would sit still while the deck
   * paged happily along. Clamped into range first, so the panel never shows a note for a
   * slide the student is being sent back from. */
  const track = () => { const n = at(); if (n >= lo && n <= hi) current.value = n; };
  let fixing = false;
  const clamp = () => {
    const n = at();
    if (fixing || !n || (n >= lo && n <= hi)) return;
    fixing = true;
    win.history.back();
    /* A backstop, not the mechanism. `back()` relies on the previous entry being in range,
     * which it is because every entry has passed through here - but a hash typed straight
     * into the address bar has no in-range entry behind it at all. */
    win.setTimeout(() => {
      fixing = false;
      const m = at();
      if (m && (m < lo || m > hi)) goTo(m < lo ? lo : hi);
    }, 80);
  };

  /* No teardown: these live on the frame's own window, which the browser destroys when the
   * iframe navigates or the step is left. The iframe is keyed on `src`, so moving between
   * two topics of one deck builds a new element rather than reusing this one with a stale
   * range closed over. */
  /* Where the student actually is, reported outwards so a tutor's client can broadcast it.
   * Off the same hash watch as the clamp and the notes panel - a third listener would be a
   * third thing that stops working the day vue-router changes how it navigates. */
  const both = () => { clamp(); track(); emit('slide', current.value); };
  const push = win.history.pushState;
  win.history.pushState = function (...a) { const r = push.apply(this, a); both(); return r; };
  win.addEventListener('popstate', both);
  win.addEventListener('hashchange', both);
  both();

  /* Driven from outside. `replace` rather than assigning the hash, so following a tutor
   * through nine slides does not put nine entries in the student's history and make Back
   * a slow walk backwards through the lesson. */
  stopDriving?.();
  stopDriving = watch(() => props.goto, n => {
    if (!n || n === at()) return;
    /* AGAINST THIS FRAME'S WINDOW AND NO OTHER. The iframe is keyed on `src`, so a new one is
     * built whenever the deck or the topic changes - and this watcher is not torn down until
     * the replacement has finished loading. A drive arriving in that gap would be written
     * into a window the browser has already discarded. */
    if (frame.value?.contentWindow !== win) return;
    goTo(n);
  }, { immediate: true });
};

</script>

<template>
  <article class="slidestep">
    <header>
      <span class="eyebrow">Slides</span>
      <h2>{{ row.title }}</h2>
      <span class="count">{{ range }}</span>
      <div class="actions">
        <!-- Offered only when the topic actually has notes. A toggle that opens an empty
             panel teaches a student that the feature is broken rather than that this deck
             is quiet. -->
        <button v-if="noteCount" class="notesbtn" :class="{ on: showNotes }"
                :aria-pressed="showNotes"
                :title="showNotes ? 'Hide the notes' : `Notes (${noteCount} slides)`"
                @click="showNotes = !showNotes">
          <Icon name="notes" :size="15" />
        </button>
        <button v-if="noteCount && showNotes" class="notesbtn"
                :title="side === 'row' ? 'Move the notes below' : 'Move the notes beside'"
                @click="side = side === 'row' ? 'column' : 'row'">
          <Icon :name="side === 'row' ? 'rows' : 'columns'" :size="15" />
        </button>
        <DeckActions :deck="base" :open="src" :name="row.title" />
      </div>
    </header>
    <!-- The frame is held at 16:9 rather than filled to the pane. A deck letterboxes itself
         to that ratio against a BLACK #slide-container, so any other shape puts black bands
         above and below the slide, with Slidev's own controls sitting in them - which reads
         as the deck using the wrong theme. Giving it exactly the shape it renders at means
         there is no letterbox to colour, and the controls sit over the slide where they
         were designed to. What is left over is the player's own themed ground. -->
    <!-- `single` rather than `v-if` on the pane: SplitPane keeps its remembered size and
         the frame is not torn down and rebuilt - which would reload the iframe and lose the
         student's place in the topic - every time the notes are toggled. -->
    <SplitPane class="work" :direction="side" :single="!showNotes"
               :storage-key="`slides-notes-${side}`"
               :initial="side === 'row' ? 68 : 62" :min="30" :max="85" :min-px="200">
      <template #a>
        <div class="frame">
          <div class="stage">
          <!-- Keyed on src so moving between two topics of the same deck reloads the frame
               at the new hash. Without it the iframe keeps its old location: same document,
               and the router has already consumed the hash it booted with. -->
          <p v-if="!src" class="nodeck">These slides could not be found. The topic is here and
            its exercises still work — it is the deck itself that is missing.</p>
          <iframe v-else ref="frame" :key="src" :src="src" :title="`Slides: ${row.title}`"
                  @load="onLoad"></iframe>
          </div>
        </div>
      </template>

      <template #b>
        <aside class="notes">
          <div class="notehead">
            <span class="eyebrow">Notes</span>
            <span class="count">slide {{ current }}</span>
          </div>
          <!-- Keyed on the slide so the pane scrolls back to the top when the student
               pages: a long note left half-scrolled under a short one reads as the panel
               having failed to update. -->
          <div v-if="noteHtml" :key="current" class="notebody" v-html="noteHtml"></div>
          <p v-else-if="notes" class="quiet">No notes on this slide.</p>
          <p v-else class="quiet">Loading…</p>
        </aside>
      </template>
    </SplitPane>
  </article>
</template>

<style scoped>
/* Said plainly rather than drawn as an error: a missing deck is a content problem somebody
   has to fix in the course repo, and nothing the student did or can do anything about. */
.nodeck { margin: 24px; font-size: 13px; line-height: 1.6; color: var(--ice-fg-muted); }
/* THE ROOT CLASS HAS TO BE UNIQUE ACROSS THE WHOLE APP, not just unique in here.
 *
 * Vue's scoped CSS still reaches a child component's ROOT element - that is deliberate, so
 * a parent can position the child it renders. So App.vue's rules land on this <article>.
 * It was `class="step"`, and App.vue scopes `.step { width: 26px; height: 22px }` for the
 * topic-hop buttons in the sidebar. The frame rendered, the deck inside it booted fine, and
 * the whole thing was laid out at 26x22 pixels - a blank strip under a correct header,
 * which reads as "the deck failed to load" and sends you looking at iframes and CORS.
 *
 * Same shape as App.vue's `.bar` once rounding TopBar's corners, because TopBar's root
 * happened to be <header class="bar">. Pick a name nothing else would choose. */
.slidestep { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; height: 100%; }
.slidestep .work { min-height: 0; min-width: 0; }
.slidestep > header { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px 12px; }
.slidestep .eyebrow { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
           font-family: var(--ice-font-mono); color: var(--ice-primary-strong); }
.slidestep h2 { margin: 0; font-size: 18px; line-height: 1.3; }
.slidestep .count { font-size: 11px; font-family: var(--ice-font-mono); color: var(--ice-fg-muted); }
/* The header's controls, as one group. `gap` rather than margins because the notes buttons
   come and go - the orientation toggle only exists while the panel is open - and a margin
   on a button that is not rendered spaces nothing. The wider gap before DeckActions says
   these are two groups: what to do with the notes, and what to do with the deck. */
.slidestep .actions { margin-left: auto; align-self: center;
                      display: flex; align-items: center; gap: 4px; }
.slidestep .actions :deep(.deckactions) { margin-left: 8px; }
/* Same geometry as DeckActions' own buttons, deliberately: they sit in one row and a
   control that is two pixels different from its neighbour reads as misaligned rather than
   as distinct. */
.slidestep .notesbtn { display: grid; place-items: center; width: 28px; height: 28px;
                       border-radius: var(--ice-radius); color: var(--ice-fg-muted);
                       background: none; border: 0; cursor: pointer; }
.slidestep .notesbtn:hover { color: var(--ice-fg); background: var(--ice-bg-soft); }
.slidestep .notesbtn:focus-visible { outline: 2px solid var(--ice-primary); outline-offset: -2px; }
/* Pressed, not merely hovered: this one is a toggle and has to say which state it is in. */
.slidestep .notesbtn.on { color: var(--ice-primary); background: var(--ice-primary-soft); }
/* Centres the deck in whatever space the pane has, and owns the surround.
 *
 * THE STAGE IS THE SLIDE PLUS THE CONTROL STRIP, and it is sized so that BOTH fit. The
 * previous version sized the stage at exactly 16:9 with `max-height: 100%` as the guard and
 * had the iframe overhang it by `--bar` pixels, on the reasoning that the overhang would
 * land in the frame's bottom padding. Two fragile things stacked, and both gave way at once
 * on a wide window: the percentage max-height did not clamp against the grid area, so the
 * stage grew past the frame, and the overhanging strip - the whole control bar - was then
 * clipped clean off. Measured at 2350x1396: the frame clipped at y=1312 and the bar sat at
 * 1435-1505. Narrower windows were fine, because the width-derived height still fit, which
 * is what made it look like a large-window bug rather than a layout one.
 *
 * So: no overhang, and no percentage maximum. `min()` over container-query units states the
 * constraint directly - the widest 16:9 slide whose strip ALSO fits the height - and the
 * iframe simply fills the stage. Nothing can be clipped because nothing sticks out.
 *
 * cqw/cqh are the container's CONTENT box, so the padding is already excluded from both. */
.slidestep .frame { --bar: 74px;
                    flex: 1; min-height: 0; min-width: 0;
                    container-type: size;
                    display: grid; place-items: center; min-height: 0; overflow: hidden;
                    padding: 20px;
                    border-top: 1px solid var(--ice-border); }
.slidestep .stage { --w: min(100cqw, (100cqh - var(--bar)) * 16 / 9);
                    position: relative;
                    width: var(--w); height: calc(var(--w) * 9 / 16 + var(--bar)); }
/* The strip is where Slidev's control bar lands: the injected CSS pins the slide to the top
   of the deck's container, so the leftover height collects underneath it. The bar is white
   with black icons there, against the iframe's own white - legible, and checked rather than
   assumed.

   White behind it deliberately - a deck is its own site with its own light theme, and the
   player's dark ground showing through while it loads reads as a broken frame. */
.slidestep iframe { position: absolute; inset: 0; width: 100%; height: 100%;
         border: 0; background: #fff;
         border-radius: var(--ice-radius); box-shadow: 0 2px 18px var(--ice-scrim); }

/* THE NOTES. Prose, so they get the reading measure and the body font rather than the
   monospace-and-tables treatment the rest of this pane wears. */
.slidestep .notes { flex: 1; min-height: 0; min-width: 0;
                    display: flex; flex-direction: column;
                    background: var(--ice-bg-soft); }
.slidestep .notehead { display: flex; align-items: baseline; gap: 10px;
                       padding: 14px 20px 8px; }
.slidestep .notehead .count { margin-left: auto; }
.slidestep .notebody { flex: 1; min-height: 0; overflow: auto; padding: 0 20px 24px;
                       font-size: 14px; line-height: 1.65; max-width: 72ch; }
.slidestep .notebody :deep(p) { margin: 0 0 .8em; }
.slidestep .notebody :deep(ul), .slidestep .notebody :deep(ol) { margin: 0 0 .8em; padding-left: 1.3em; }
.slidestep .notebody :deep(li) { margin: 0 0 .35em; }
.slidestep .notebody :deep(code) { font-family: var(--ice-font-mono); font-size: .88em;
                                   background: var(--ice-raise-strong); padding: 1px 5px;
                                   border-radius: 4px; }
.slidestep .notebody :deep(pre) { background: var(--ice-code-bg); padding: 10px 12px;
                                  border-radius: var(--ice-radius); overflow: auto; }
.slidestep .notebody :deep(pre code) { background: none; padding: 0; }
.slidestep .quiet { color: var(--ice-fg-muted); font-size: 13px; padding: 0 20px; margin: 0; }
</style>
