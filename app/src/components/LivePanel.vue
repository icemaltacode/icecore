<script setup>
/* Who is in the room.
 *
 * FOUR STATES, and only three of them are in the brief. "Online" and "offline" are not
 * enough to run a lesson from: somebody who has stopped following is not absent, and
 * drawing them as offline is how a tutor concludes half the room has left. So:
 *
 *   with you        connected, and on the same thing you are
 *   somewhere else  connected, and not - reading ahead, or stuck two exercises back
 *   idle            connected, and has done nothing for a quarter of an hour
 *   not here        no socket at all
 *
 * The list is EVERYONE IN THE COHORT, not everyone connected. A panel built from
 * connections alone shows a class of twelve as a class of three and gives a tutor no way to
 * see who is missing - which is most of what they would open this for.
 *
 * A STUDENT SEES THE SAME PANEL WITHOUT THE CONTROLS. It has no per-person actions, and the
 * roster comes from the server rather than from the user listing precisely so that it can
 * be shown to somebody who may not read that listing.
 *
 * IT STARTS COLLAPSED FOR A STUDENT AND OPEN FOR A TUTOR, which is one default expressing
 * two different jobs. Knowing who is in the room IS the tutor's job and the panel is half
 * of what they came for; for a student it is context, and a column of classmates beside an
 * exercise is 336px taken from the thing they are actually meant to be doing.
 *
 * IT CARRIES THE CHAT TOO, which is why collapsing it has to leave more than a rail with a
 * head-count on it: a student who folds the class away must still be told when they are
 * being spoken to, or the collapse is a way of missing the lesson.
 *
 * Collapsed it leaves a RAIL rather than nothing, the same way the sidebar does - an edge
 * you can only find by hovering is one most people never find - and the rail carries the
 * count, because "how many are here" is the one thing worth knowing without opening it.
 *
 * The choice is remembered per browser, and remembered SEPARATELY from the default: a
 * student who opens it once has said something about how they want to work, and being
 * collapsed again in every subsequent lesson would read as the panel refusing to stay put.
 */
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { room, presenceOf } from '../delivery.js';
import { chat } from '../chat.js';
import Icon from './Icon.vue';
import LiveChat from './LiveChat.vue';

const props = defineProps({
  /** Where the tutor is, so "somewhere else" has something to be else from. */
  leaderAt: [String, Number],
  /** An admin gets per-person controls and the panel open; a student gets neither. */
  canControl: Boolean,
  /* Where THIS client is - which is not `leaderAt` for a student who has wandered. Passed
   * straight through to the chat, where it decides whether a message's origin is worth
   * drawing. */
  hereAt: [String, Number],
  /** Everyone's mark on the exercise on screen, `{ [sub]: mark }`. Empty off an exercise. */
  marks: { type: Object, default: () => ({}) },
  /* Whether to group by RESULT rather than by presence. Passed rather than derived from
   * `marks` being non-empty: an exercise nobody has answered yet is exactly when a tutor
   * most wants to see the class listed as not having answered, and a panel that only became
   * a results view once somebody had would flip between two layouts under them. */
  grading: Boolean,
  /** Whose screen is being driven right now, so their row says so instead of offering it. */
  controlled: String,
});
const emit = defineEmits(['width', 'goto', 'control']);

const OPEN_KEY = 'ice-live-participants';
const remembered = localStorage.getItem(OPEN_KEY);
/* Null means never asked, and only then does the role decide. Same shape as the sidebar's
 * pin: a remembered answer outranks the default, and the default is only ever consulted
 * once per browser. */
const open = ref(remembered === null ? !!props.canControl : remembered === 'yes');
watch(open, v => {
  localStorage.setItem(OPEN_KEY, v ? 'yes' : 'no');
  emit('width', v);
});
onMounted(() => emit('width', open.value));

/* Something asked for the chat. The panel opens ITSELF rather than being opened, because it
 * owns this preference and writes it to localStorage - a second writer would disagree with
 * this one the first time either changed. */
watch(() => chat.reveal, () => { open.value = true; });

/* Idle is a function of elapsed time, so nothing changes on screen unless something asks
 * again. Once a minute is enough for a fifteen-minute threshold and is not a render loop. */
const now = ref(Date.now());
let tick;
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 30000); });
onUnmounted(() => clearInterval(tick));

const same = (a, b) => a != null && b != null && String(a) === String(b);

const LETTERS = 'ABCDEFGHIJ';

/* WHAT ONE PERSON'S ROW SAYS, and it is a different question on an exercise from on a
 * slide. Off an exercise the useful fact is where they are; on one it is what they
 * answered - which is why this is one list re-grouped rather than two panels.
 *
 * A MARK OUTRANKS PRESENCE. Somebody who answered correctly and then shut their laptop
 * belongs under Correct, because the tutor's question is "who has got this" and not "who is
 * looking at it now". They are dimmed instead, by the same `away` class the presence view
 * uses, so the panel never claims somebody is there. */
const people = computed(() => (room.members || []).map(m => {
  const at = room.here[m.sub];
  const seen = presenceOf(m.sub, now.value);
  const mark = props.grading ? props.marks?.[m.sub] : null;
  const state = mark
    ? (mark.pass ? 'right' : mark.error ? 'stuck' : 'wrong')
    : seen !== 'here' ? seen
      : same(at?.position?.exercise, props.grading ? props.hereAt : props.leaderAt)
        ? (props.grading ? 'trying' : 'with')
        : 'elsewhere';
  return {
    ...m,
    name: at?.name || m.name || '',
    role: at?.role || 'student',
    position: at?.position || null,
    mark,
    away: seen === 'away',
    state,
  };
}));

/* The tutor is in `here` and usually not in `members` - an admin has no membership row, and
 * would otherwise be missing from the panel of the room they are running. */
const leader = computed(() => Object.values(room.here)
  .find(p => p.role === 'tutor' && !(room.members || []).some(m => m.sub === p.sub)));

/* Two vocabularies over the same rows. The results one is ordered by how much it wants a
 * tutor's attention rather than alphabetically or by presence: right, then wrong, then the
 * ones who cannot get the thing to run at all, then everybody still working. Empty groups
 * are dropped, so most lessons show three of these. */
const PRESENCE = [
  { id: 'with', title: 'With you', dot: 'on' },
  { id: 'elsewhere', title: 'Somewhere else', dot: 'on' },
  { id: 'idle', title: 'Idle', dot: 'idle' },
  { id: 'away', title: 'Not here', dot: 'off' },
];
const RESULTS = [
  { id: 'right', title: 'Correct', dot: 'good' },
  { id: 'wrong', title: 'Not right yet', dot: 'bad' },
  /* Its own group, not folded into the one above. `grade.js` already keeps an error apart
   * from a wrong answer for the Ask AI nudge, and six people whose query will not run is a
   * different problem from six who have misread the question. */
  { id: 'stuck', title: 'Could not run it', dot: 'bad' },
  { id: 'trying', title: 'Working on it', dot: 'on' },
  { id: 'elsewhere', title: 'Somewhere else', dot: 'on' },
  { id: 'idle', title: 'Idle', dot: 'idle' },
  { id: 'away', title: 'Not here', dot: 'off' },
];
const grouped = computed(() => (props.grading ? RESULTS : PRESENCE)
  .map(g => ({ ...g, people: people.value.filter(p => p.state === g.id) }))
  .filter(g => g.people.length));

const hereCount = computed(() => people.value.filter(p => !p.away).length);
const rightCount = computed(() => people.value.filter(p => p.state === 'right').length);

/* What a row says under the name while grading. The option matters most: a class that
 * mostly chose C has misunderstood one particular thing, and which one is the lesson. */
const note = p => {
  if (!p.mark) return '';
  if (p.mark.choice != null) return `Chose ${LETTERS[p.mark.choice] ?? p.mark.choice}`;
  if (p.mark.step != null && p.mark.step > 0) return `Step ${p.mark.step + 1}`;
  return '';
};
const initials = n => (n || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
</script>

<template>
  <!-- Collapsed, the rail still says how many are here: a control that only says
       "participants" makes you open it to find out whether anything has changed. -->
  <aside v-if="!open" class="roomrail">
    <button class="railbtn" type="button" :title="`Participants — ${hereCount} here`"
            @click="open = true">
      <Icon name="people" :size="16" />
      <span class="badge">{{ hereCount }}</span>
    </button>
    <!-- Collapsed, the rail is the ONLY thing that can say something has been said. The
         badge is what makes closing the panel a reasonable thing for a student to do: they
         can put the class away and still be told when they are being spoken to. Absent
         while the chat is floating, where it is on screen and counts nothing. -->
    <button v-if="!chat.popped" class="railbtn" type="button"
            :title="chat.unread ? `Chat — ${chat.unread} new` : 'Chat'"
            @click="open = true">
      <Icon name="chat" :size="16" />
      <span v-if="chat.unread" class="badge">{{ chat.unread }}</span>
    </button>
  </aside>

  <aside v-else class="roompanel" :class="{ split: !chat.popped }">
    <header>
      <Icon name="people" :size="15" />
      <h4>{{ grading ? 'This exercise' : 'Participants' }}</h4>
      <!-- The number that answers the question the heading just asked. Off an exercise that
           is how many of the class are here; on one it is how many have got it. -->
      <span class="pill" :class="{ scored: grading }">
        {{ grading ? rightCount : hereCount }} / {{ people.length }}<template v-if="grading"> right</template>
      </span>
      <button class="shut" type="button" title="Hide the participants" @click="open = false">
        <Icon name="chevron" :size="14" />
      </button>
    </header>

    <div class="people">
      <div v-if="leader" class="group"><span class="dot on"></span>Leading</div>
      <div v-if="leader" class="person">
        <span class="avatar lead">{{ initials(leader.name) }}</span>
        <span class="nm">{{ leader.name }}<em>Educator</em></span>
      </div>

      <template v-for="g in grouped" :key="g.id">
        <div class="group">
          <span class="dot" :class="g.dot"></span>{{ g.title }}<span class="n">{{ g.people.length }}</span>
        </div>
        <div v-for="p in g.people" :key="p.sub" class="person" :class="{ away: p.away }">
          <span class="avatar">{{ initials(p.name) }}</span>
          <span class="nm">{{ p.name || '—' }}
            <!-- Only where it says something. "Somewhere else" without saying where is a
                 label that makes a tutor go and ask. -->
            <em v-if="grading && note(p)">{{ note(p) }}</em>
            <em v-else-if="p.state === 'elsewhere' && p.position?.title">{{ p.position.title }}</em>
            <em v-else-if="p.state === 'idle'">Nothing for a while</em>
          </span>

          <!-- ONLY FOR SOMEBODY WHO IS ACTUALLY THERE. Their browser is what applies a
               drive, so offering this against an empty chair is offering to control nothing
               - the server refuses it and says so, and a button that always explains itself
               is a button that should not have been enabled.
               Hidden until the row is hovered or focused, because a column of twelve names
               each carrying a live control is a screen you read carefully before touching. -->
          <button v-if="canControl && !p.away && p.sub !== controlled" class="take" type="button"
                  :title="`Control ${p.name || 'this student'}'s screen`"
                  @click="emit('control', { sub: p.sub, name: p.name })">
            <Icon name="remote" :size="14" />
          </button>
          <span v-else-if="p.sub === controlled" class="driving" title="You are controlling this screen">
            <Icon name="remote" :size="13" />
          </span>
        </div>
      </template>

      <p v-if="!people.length && !leader" class="none">Nobody is in this cohort yet.</p>
    </div>

    <!-- Under the room rather than beside it: they are two views of the same twelve people,
         and a tab strip would make reading one cost seeing the other. Gone from here the
         moment it is popped out, so there is exactly one of it on screen. -->
    <LiveChat v-if="!chat.popped" :here-at="hereAt" @goto="id => emit('goto', id)" />
  </aside>
</template>

<style scoped>
/* BOTH ROOT CLASSES ARE UNIQUE ACROSS THE WHOLE APP, and `rail` and `livepanel` were not.
   Vue's scoped CSS still reaches a child component's root element, so App.vue's rules land
   on whichever <aside> this renders - and App.vue has an `aside` rule and a `.rail` for the
   sidebar on the opposite edge. The panel came out with a border down its RIGHT side, which
   reads as a stray divider rather than as a collision; the collapsed rail would have taken
   the sidebar's padding as well. Same failure `SlidesStep.vue` documents at length.

   Neither can simply be overridden either: `aside { border-right }` has nothing here to
   override it, so `border-right: 0` is stated outright below.

   The rail matches the sidebar's on purpose - same width, same button, same hover. They are
   the same gesture on opposite edges of the screen, and two spellings of it would read as
   two different kinds of thing. */
.roomrail, .roompanel { border-right: 0; }
.roomrail { background: var(--ice-bg-soft); border-left: 1px solid var(--ice-border);
            display: flex; flex-direction: column; align-items: center; padding: 16px 0; }
.railbtn { position: relative; width: 30px; height: 30px; display: grid; place-items: center;
           cursor: pointer; background: none; border: 1px solid transparent;
           border-radius: 8px; color: var(--ice-fg-muted); }
.railbtn:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }
.badge { position: absolute; top: -3px; right: -4px; min-width: 15px; height: 15px;
         padding: 0 3px; border-radius: 999px; background: var(--ice-primary);
         color: var(--ice-on-primary); font-size: 9px; font-weight: 600; line-height: 15px;
         font-family: var(--ice-font-mono); }

.roompanel { background: var(--ice-bg-soft); border-left: 1px solid var(--ice-border);
             display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0;
             overflow: hidden; }
/* The room gets what it needs and the conversation gets the rest. Not an even split: a
   roster is a fixed number of short rows and stops being more useful with more space, where
   a chat log is the opposite. Both are `minmax(0, ...)` or a long list of either pushes the
   other off the bottom of the panel instead of scrolling inside itself. */
.roompanel.split { grid-template-rows: auto minmax(64px, 1fr) minmax(190px, 1.35fr); }
header { display: flex; align-items: center; gap: 8px; padding: 12px 14px 10px;
         border-bottom: 1px solid var(--ice-border); color: var(--ice-fg-muted); }
h4 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; color: var(--ice-fg); }
.pill { display: inline-flex; align-items: center; gap: 7px; padding: 3px 10px;
        border-radius: 999px; background: var(--ice-primary-soft); color: var(--ice-fg);
        font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* A score, not a head-count. Tinted so the two never read as the same number in different
   words - they change places when the tutor moves onto an exercise, and a pill that only
   changed its digits would look like people arriving. */
.pill.scored { background: var(--ice-good-fill); color: var(--ice-good); }
/* Points at the edge it collapses towards, so it says where the panel goes rather than
   merely that it goes. */
.shut { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
        background: none; border: 1px solid transparent; color: var(--ice-fg-muted);
        cursor: pointer; }
.shut:hover { color: var(--ice-fg); border-color: var(--ice-border); background: var(--ice-bg); }
.shut :deep(.icon) { transform: rotate(-90deg); }

.people { overflow: auto; padding: 4px 8px 12px; }
.group { display: flex; align-items: center; gap: 7px; padding: 11px 6px 5px; font-size: 10px;
         letter-spacing: .08em; text-transform: uppercase; color: var(--ice-fg-muted);
         font-family: var(--ice-font-mono); }
.group .n { margin-left: auto; letter-spacing: 0; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ice-fg-muted); }
.dot.on { background: var(--ice-good-line); }
.dot.good { background: var(--ice-good); }
.dot.bad { background: var(--ice-bad); }
/* The one colour in this file that is not a palette token. Three connected states need
   three weights and the palette has good, bad and muted - amber is the missing middle, and
   idle is not a failure so it cannot borrow the bad one. */
.dot.idle { background: #d97706; }
.dot.off { background: none; border: 1.5px solid #cbd5e1; }

.person { display: flex; align-items: center; gap: 9px; padding: 6px; border-radius: 8px;
          font-size: 13px; }
.person:hover { background: var(--ice-raise); }
.take { flex: none; display: grid; place-items: center; width: 26px; height: 26px;
        border-radius: 7px; cursor: pointer; background: none; color: var(--ice-fg-muted);
        border: 1px solid transparent; opacity: 0; transition: opacity .12s; }
.person:hover .take, .take:focus-visible { opacity: 1; }
.take:hover { color: var(--ice-primary-strong); border-color: var(--ice-border);
              background: var(--ice-bg); }
/* Not a button: this one is already happening, and the way to stop it is the band rather
   than a second control tucked into a list. */
.driving { flex: none; display: grid; place-items: center; width: 26px; height: 26px;
           border-radius: 7px; background: var(--ice-primary); color: var(--ice-on-primary); }
.person.away { opacity: .55; }
.avatar { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; background: var(--ice-primary-soft);
          color: var(--ice-primary-strong); font-size: 9.5px; font-weight: 600; line-height: 1; }
.avatar.lead { background: var(--ice-primary); color: var(--ice-on-primary); }
.nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nm em { display: block; font-style: normal; font-size: 11px; color: var(--ice-fg-muted);
         overflow: hidden; text-overflow: ellipsis; }
.none { margin: 12px 6px; font-size: 12px; color: var(--ice-fg-muted); line-height: 1.5; }
</style>
