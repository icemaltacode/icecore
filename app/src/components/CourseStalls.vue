<script setup>
/* Where a class thins out, and which exercises make them ask for help.
 *
 * The only screen in this area that is not about people at all. Everything else answers
 * "how is this student doing"; this answers "is this exercise doing its job", and the fix
 * for what it finds is a commit in the course repo rather than anything here. That is the
 * boundary this area has to keep - it may show that 3.2.4 stops the class, and it may never
 * offer to edit 3.2.4. See ADMIN.md.
 *
 * A LOW SOLVE COUNT IS NOT A STALL. Solve counts fall away through a course because people
 * work through it in order, so the last exercise is always the least solved and that says
 * nothing. What says something is a *drop*: the exercise where the count falls off relative
 * to the one before it. The list is drawn in walk order so the shape is visible, and the
 * drops are named above it so it does not have to be read.
 *
 * HINTS ARE THE OTHER SIGNAL, and they are independent of position: an exercise everybody
 * eventually solves but nobody solves unaided is hard, and no count of solves can say so.
 * It is also the only thing here that distinguishes "hard" from "not reached", because a
 * PROG# row is only ever written when somebody succeeds - nothing records a failed attempt.
 */
import { computed } from 'vue';
import { walkTopic } from '../walk.js';

const props = defineProps({
  /** The course's index.json, for order and titles. */
  course: Object,
  /** The students being shown - already filtered to a cohort, if one is chosen. */
  students: Array,
  /** Hint requests per exercise id, across everyone who has ever taken this course. */
  hints: Object,
});
/* Named exercises jump to their row rather than emitting somewhere: 376 rows is too many
 * to find one in, and there is nowhere else for an exercise to go - the platform may show
 * that one stalls a class and may never offer to edit it. */
function jump(id) {
  const el = document.getElementById(`ex-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

/* An exercise id is a NUMBER in index.json and a STRING everywhere it has been stored.
 * One spelling, or every tally below silently counts nothing. */
const key = id => String(id);

/* Every row a student walks, in that order, carrying the unit it belongs to.
 *
 * Through `walkTopic` rather than a second loop over `t.exercises`, because that function
 * is the one definition of the order - its slides row opens a topic, and a list here that
 * disagreed with the player would read as exercises going missing. The unit label is the
 * only thing added, since the walk does not carry one.
 *
 * SLIDES ARE IN THE LIST because they are a place a student can BE. A bookmark on a topic's
 * slides is where most topics start, so leaving them out means a class sitting on a video
 * reads as a class sitting nowhere at all. They are not something to solve, so they carry a
 * position and nothing else. */
const rows = computed(() => {
  const out = [];
  for (const m of props.course?.modules || [])
    for (const u of m.units || [])
      for (const t of u.topics || [])
        for (const r of walkTopic(t))
          out.push({
            id: key(r.id),
            kind: r.kind,
            title: r.kind === 'slides' ? 'Slides' : r.title,
            unit: `${u.unit} ${u.title}`,
            topic: t.title,
          });
  return out;
});

const solvedBy = computed(() => {
  const n = {};
  for (const s of props.students || []) for (const id of s.solved || []) n[key(id)] = (n[key(id)] || 0) + 1;
  return n;
});

/* Where people are sitting right now. A bookmark on an exercise nobody has solved is the
 * sharpest version of stuck there is - it is the difference between a class that has not
 * reached something and a class that has stopped at it. */
const parked = computed(() => {
  const n = {};
  for (const s of props.students || []) {
    const id = s.place?.exercise;
    if (id != null) n[key(id)] = (n[key(id)] || 0) + 1;
  }
  return n;
});

const roster = computed(() => (props.students || []).length);

const listed = computed(() => {
  let prev = null;
  return rows.value.map(r => {
    const at = { ...r, parked: parked.value[r.id] || 0, hints: props.hints?.[r.id] || 0 };
    /* A slides row has no solve count, and must not be given one: a zero between two
     * exercises would read as everybody falling off a cliff and climbing back up it. It is
     * skipped for the drop as well as for the count - `prev` carries across it. */
    if (r.kind === 'slides') return { ...at, solved: null, drop: 0 };
    const solved = solvedBy.value[r.id] || 0;
    const drop = prev === null ? 0 : Math.max(0, prev - solved);
    prev = solved;
    return { ...at, solved, drop };
  });
});

/* The three sharpest drops, and only where the drop is worth a look: one person moving on
 * is not a cliff, and on a class of six neither is two. */
const cliffs = computed(() => listed.value
  .filter(r => r.drop >= Math.max(2, Math.ceil(roster.value * 0.15)))
  .sort((a, b) => b.drop - a.drop)
  .slice(0, 3));

/* Hints per solve rather than hints outright, or the answer is always the exercise the most
 * people reached. An exercise nobody has solved and everybody asked about is the top of this
 * list, which is correct. */
const hardest = computed(() => listed.value
  .filter(r => r.hints > 0 && r.kind !== 'slides')
  .map(r => ({ ...r, ratio: r.hints / Math.max(1, r.solved) }))
  .sort((a, b) => b.ratio - a.ratio || b.hints - a.hints)
  .slice(0, 3));

const anyHints = computed(() => listed.value.some(r => r.hints > 0));
const pct = n => (roster.value ? Math.round((n / roster.value) * 100) : 0);
</script>

<template>
  <div class="stalls">
    <p v-if="!rows.length" class="muted">This course has no exercises to walk through.</p>

    <template v-else>
      <div class="findings">
        <div class="finding">
          <h3>Where they thin out</h3>
          <ul v-if="cliffs.length">
            <li v-for="c in cliffs" :key="c.id">
              <button class="link" @click="jump(c.id)">{{ c.title }}</button>
              <small>{{ c.unit }} — {{ c.drop }} fewer got past it than the one before</small>
            </li>
          </ul>
          <p v-else class="muted small">No sharp drop. The class is spread out rather than
            stopped anywhere in particular.</p>
        </div>
        <div class="finding">
          <h3>Most help asked for</h3>
          <ul v-if="hardest.length">
            <li v-for="h in hardest" :key="h.id">
              <button class="link" @click="jump(h.id)">{{ h.title }}</button>
              <small>{{ h.unit }} — {{ h.hints }} hint{{ h.hints === 1 ? '' : 's' }}
                against {{ h.solved }} solve{{ h.solved === 1 ? '' : 's' }}</small>
            </li>
          </ul>
          <!-- Said plainly rather than shown as three zeroes: hints have only been counted
               per exercise since the ledger went in, so an empty list here means "not yet"
               and not "nobody needed help". -->
          <p v-else class="muted small">No hints recorded on this course yet. They have only
            been counted per exercise since the spend ledger was added.</p>
        </div>
      </div>

      <div class="tablewrap">
        <table>
          <thead>
            <tr><th>Exercise</th><th>Solved</th><th>Here now</th><th v-if="anyHints">Hints</th></tr>
          </thead>
          <tbody>
            <template v-for="(r, i) in listed" :key="r.id">
              <tr v-if="i === 0 || listed[i - 1].unit !== r.unit" class="group">
                <td :colspan="anyHints ? 4 : 3">{{ r.unit }}</td>
              </tr>
              <tr :id="'ex-' + r.id"
                  :class="{ cliff: r.drop >= Math.max(2, Math.ceil(roster * 0.15)),
                            slides: r.kind === 'slides' }">
                <td>
                  <span class="name">{{ r.title }}</span>
                  <small class="topic">{{ r.topic }}</small>
                </td>
                <!-- Slides are watched, not solved. A dash rather than an empty bar, which
                     would read as nought out of the class. -->
                <td v-if="r.kind === 'slides'" class="cell num">—</td>
                <td v-else class="cell">
                  <div class="bar">
                    <span class="track"><span class="fill" :style="{ width: pct(r.solved) + '%' }"></span></span>
                    <span class="num">{{ r.solved }}</span>
                  </div>
                </td>
                <td class="num">{{ r.parked || '' }}</td>
                <td v-if="anyHints" class="num">{{ r.hints || '' }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.muted { color: var(--ice-fg-muted); font-size: 13px; line-height: 1.6; max-width: 60ch; }
.muted.small { font-size: 12px; margin: 0; }

.findings { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
.finding { border: 1px solid var(--ice-border); border-radius: var(--ice-radius);
           background: var(--ice-bg-soft); padding: 13px 15px; }
h3 { margin: 0 0 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
     color: var(--ice-fg-muted); font-weight: 500; }
.finding ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.finding li { font-size: 13.5px; }
.finding small { display: block; color: var(--ice-fg-muted); font-size: 11.5px; margin-top: 2px; }

.tablewrap { overflow-x: auto; border: 1px solid var(--ice-border); border-radius: var(--ice-radius); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
     color: var(--ice-fg-muted); font-weight: 500; padding: 10px 14px;
     background: var(--ice-bg-soft); border-bottom: 1px solid var(--ice-border); white-space: nowrap; }
td { padding: 8px 14px; border-bottom: 1px solid var(--ice-border); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tr.group td { background: var(--ice-bg-soft); font-size: 11px; text-transform: uppercase;
              letter-spacing: .05em; color: var(--ice-fg-muted); padding: 7px 14px; }
tr.cliff .name { color: var(--ice-bad); }
tr.slides .name { color: var(--ice-fg-muted); font-style: italic; }
/* Jumped-to rows say so briefly. Scrolling something into the middle of a long list still
   leaves you hunting for which row moved. */
tr.flash td { background: var(--ice-primary-soft); transition: background .9s ease-out; }
.name { font-size: 13.5px; }
.topic { display: block; color: var(--ice-fg-muted); font-size: 11.5px; }
.num { font-size: 12.5px; color: var(--ice-fg-muted); white-space: nowrap; }
.cell { min-width: 170px; }
.bar { display: flex; align-items: center; gap: 9px; }
.track { flex: 1; height: 6px; border-radius: 3px; background: var(--ice-bg);
         border: 1px solid var(--ice-border); overflow: hidden; }
.fill { display: block; height: 100%; background: var(--ice-primary); }
.bar .num { flex: none; }
@media (max-width: 760px) { .findings { grid-template-columns: 1fr; } }
</style>
