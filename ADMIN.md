# The admin area — plan

Today the admin area is user management: one modal, one table, four verbs. It is good at
what it does. What it is not is an *area* — there is nowhere for a second screen to go, and
the only noun it knows is a person.

This plan gives it three sections, and argues that the second of them — a course-shaped
page — is where nearly all the remaining value is, because it is the only one that can tell
a tutor something they cannot already see by asking the student.

Status: **steps 1 to 7 are built and deployed.** Cohorts, the spend ledger, the route and
shell, the person page, the course page, and the stall view - which is the first thing to
read the ledger, and the reason it was written before anything could. Nothing reads the ledger yet, which is the ordering rather than
an oversight. What is done is listed under [Already done](#already-done); everything else
is proposed. The backlog line this replaces is "track student progress in admin"; remote
control is still on it, pointed back here.

## Decisions taken

| | |
|---|---|
| **Shape** | Three sections — People, Courses, Platform — not a growing pile of modals |
| **Addressing** | A hash route, hand-rolled. No `vue-router` |
| **Cohorts** | A group of **people**, not of enrolments. An axis on every screen, not a section of its own |
| **Cohort data** | Fan out per student, exactly as the user listing already does. **No new index** |
| **Difficulty** | Derived from solves, drop-off and hints first. Attempts are not recorded, and not yet worth recording |
| **Support** | Read the student's own submitted code. View-as now, **shaped so remote control is an addition and not a rewrite** |
| **Spend** | A ledger row of its own, in the student's partition, written from the day the decision lands |
| **Boundary** | The admin area reads content and never writes it |

## What is wrong with the shape today

`showAdmin = true` in `App.vue` is a boolean over the course grid. That has three
consequences, and only the first is cosmetic:

- **There is no address.** The player addresses which *course* is open — `?course=<id>`,
  read on load — but nothing inside a screen. So an admin cannot link anyone to a person,
  cannot reload onto one, and cannot open two side by side.

  The admin area's own state went in the **fragment** rather than beside `?course=`, and
  that is a split rather than a second mechanism: the query names which content is open and
  is the thing worth sending somebody, while `#/admin/people/<sub>` is where you are inside
  a screen only admins can reach. It stays out of a URL a student might be handed, and it
  is a path, which the query would have to fake — `?admin=people&person=<sub>` says the same
  thing worse and gets worse again one level down. The slides iframe patches `pushState` on
  its *own* document, so the two never meet.
- **Every new feature has to be a modal or a column.** The user dialog is already at the
  size where the next thing added to it makes it a page badly.
- **The course is a filter over people, and never a thing to stand on.** "Who is on
  Data Analyst SQL" is answerable; "how is Data Analyst SQL going" is not expressible.

## The three sections

```
┌──────────────────────────────────────────────────────────────┐
│  icecore · admin      People │ Courses │ Platform       ◐  ✕  │
│                       ╰ Cohorts                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   People  ─────────────→  a person  ──┐                      │
│     └ Cohorts ─────────→  a cohort  ──┼── the useful cell:   │
│                                       │   this class, this   │
│   Courses ─────────────→  a course  ──┘   course, this answer │
│                                                              │
│   Platform                                                   │
└──────────────────────────────────────────────────────────────┘
```

`#/admin`, `#/admin/people/<sub>`, `#/admin/cohorts/<id>`, `#/admin/courses/<id>`. Parsing
that by hand is a few lines of `location.hash`; adding a router to a player that has managed
without one is a dependency bought for four routes.

**The cross-links are the point.** From a course you reach a person, from a person you reach
what they have done, from a cohort you reach both — and the cell where they meet, *this
student, this course, this exercise, this answer*, is the screen a tutor actually wants when
somebody says they are stuck.

## People

The list stays as it is. It is already the right list: people rather than enrolments, the
course as a filter, `truncated` said out loud rather than a partial list passing as the
pool.

What changes is that a row opens a **page** rather than a dialog. The dialog can stay for
add-and-edit; it is the wrong container for the things below.

### The person page

- The account facts `UserDialog` already shows: name, email, cohorts, courses, admin,
  enabled, whether the invitation has ever been used, resend.
- **What they have done, per course.** Solved out of total, XP, first solve, most recent
  solve, and where they are up to.
- **Their own submitted answers.** This is the first screen I would build.

### Why their code, and why it is first

`infra/lambda/progress/index.mjs` already writes `code` onto every `PROG#` row — the
student's own source, keyed by step, capped at 20KB a step and 60KB a row. It is stored so
that returning to finished work shows their answer rather than a blank editor. Nothing
reads it but the student.

A tutor reading the query a student actually wrote, against the exercise they are actually
stuck on, is most of what "remote-control the session of a logged in user" was reaching
for. It needs **no new writes, no channel, and no consent question** — the data is sitting
in the table.

So: a read path on `/api/admin`, authorised the way the rest of that function is, returning
one student's progress and submissions for one course.

### View-as now; remote control later, as an addition

**Only view-as gets built now** — read-only, the real player rendered as that student sees
it. `App.vue` already derives an admin's course list by skipping the enrolment filter;
view-as is that same derivation pointed at somebody else's rows.

**Remote control is wanted later**: the admin sees the student's live screen, both cursors
are visible to both, and the admin can navigate on their behalf. Not built now. But
view-as must be built so that it is the *same feature with a different source*, not
something that gets thrown away. Five constraints, all cheap now and expensive to retrofit:

1. **The viewed session is a value, not a mode.** One object — identity, enrolment,
   progress, position — that the player reads instead of reaching for its own. View-as
   fetches it once; remote control feeds the same object from a channel. A boolean checked
   at twenty call sites is what would have to be un-picked later.
2. **Never hydrate through the local record.** `progress.js` and `progress-store.js` write
   localStorage keys. A view-as that loads a student through them **overwrites the admin's
   own progress** and leaves live updates nowhere to land. The viewed session is in memory
   and touches no key.
3. **Position must be explicit and settable from outside.** Course, unit, topic, exercise,
   step, slide number, editor contents. Remote control *is* "set the position from
   outside"; if position lives only inside components, nothing outside can set it. This is
   the second reason the hash route is item one.
4. **One write gate, at the API layer.** View-as makes progress PUTs inert. Remote control
   later needs them to go through — as the student, attributed to the admin — which is one
   gate changing behaviour rather than a guard removed from every call site.
5. **Do not render a snapshot server-side.** A dump of what the student's page looked like
   is much easier and is a dead end: it becomes nothing.

What remote control still needs, and what nothing here pre-builds: a channel (there is no
WebSocket anywhere in this stack — API Gateway's WebSocket API or WebRTC would both be new
infrastructure), the student's client *sending* rather than only receiving, cursor
transport, and a rule for what happens when two people type at once.

**And one line worth keeping straight while both exist.** View-as is invisible to the
student, which is fine for reading rows they have already submitted — a tutor reading
homework. Taking over their screen is not that, and the design Keith wants has the student
seeing the admin's cursor, so it announces itself by construction. Keeping view-as
read-only is what keeps that distinction clean until the channel exists.

## Cohorts

**A cohort is a group of people** — an intake, a class, "Sept 2026 evening". Not a group of
enrolments and not a property of a course: an intake may take two courses, and a cohort
that named one course would be a second, worse spelling of enrolment.

So a cohort does not appear in the navigation as a peer of Courses. It is **an axis**: a
filter in People, a page of its own reachable from there, a pivot on the course page ("this
class, this course"), and a grouping on spend.

### The rows

| Row | Key | Why |
|---|---|---|
| The cohort | `pk = COHORTS`, `sk = COHORT#<id>` | Title, created, archived. One query lists every cohort |
| Membership | `pk = USER#<sub>`, `sk = COHORT#<id>` | Name and email cached, exactly as `ENROL#` does |

Membership in the **user's** partition, not the cohort's, for two reasons that both already
have precedent here: `byCourse` inverts the key, so `COHORT#<id>` is a partition and the
cohort's roster is one query with names on it; and `forget()` deletes everything under
`USER#<sub>`, so removing a person removes their membership without anything new being
written to remember to do it.

**A cohort needs a row of its own because an empty cohort has to exist.** You name the class
before you import it, and a list derived from membership cannot represent a cohort with
nobody in it yet — which is exactly the state it is in at the moment you need to pick it.

**The title lives on the cohort row and is not cached on membership.** That differs from the
person's name, which *is* cached on `ENROL#` rows, and the difference is the reason: the
name cache exists so `byCourse` can answer without a call to the pool. Anything reading a
cohort has already read the cohort row.

### How they are set

- **Creatable inline, from both places that create people.** The dialog and the CSV import
  each offer the existing cohorts and let you name a new one without going somewhere else
  first. POST accepting an unknown cohort creates it.
- **Additive on POST, the whole set on PUT** — the same rule courses already follow, for the
  same reason: the import runs POST once per row, and a row that does not mention a cohort
  must not take one away.
- **The import's cohort applies to every row**, like the ticked courses, and for the same
  reason — a plain class list has no cohort column, and that is the case the field matters
  most in. A `cohort` column may also name one per row.
- **The `#` legend at the bottom of the template lists existing cohort ids**, as it already
  does for courses. A cohort typed slightly wrong is a class that quietly splits in two.
- **Archived, not deleted, when an intake finishes.** A training company accumulates
  intakes; a picker holding forty dead ones is a picker nobody reads. Archived cohorts keep
  their statistics and drop out of the pickers.
- **Deleting a cohort deletes the grouping and none of the people.** Say it on the button:
  "delete" beside a list of students reads as deleting students.

A person may be in more than one cohort. Somebody who comes back for a second intake is the
ordinary case, not an anomaly to design against.

### Two details the listing forces

**The id is a slug of the title, taken once; the title stays editable and the id never
moves.** A tutor types the id into a CSV column, so it has to be `sept-2026-evening` rather
than an opaque key — and re-slugging on rename would rewrite every membership row to keep a
URL tidy. Drift between a renamed title and its original slug is the ordinary, harmless
outcome. The import matches a cohort column on the id *or* the title, case-insensitively.

**An unknown cohort in a CSV is created, and the preview says so before anything is sent.**
`UserImport` already parses locally and already reports unknown courses that way; a cohort
it is about to create is the same sentence. Auto-creating silently is how a class splits in
two on a typo, and refusing outright would defeat naming an intake at import time — the
preview is what makes creating safe, and it exists.

**The listing reads both prefixes in ONE query per user.** `COHORT#` and `ENROL#` are
adjacent in sort order, so `sk BETWEEN 'COHORT#' AND 'ENROL$'` returns exactly the two and
nothing else — where a second `begins_with` query would double the fan-out on the slowest
screen in the app. `$` is one codepoint above `#`, which is what makes the upper bound
exclusive of everything after it. **The fragility is worth writing at the call site: a new
sort-key prefix beginning with D or E would fall inside that range**, and would arrive in
the listing as an enrolment nobody wrote.

## Courses

The missing half, and where the teaching value is. One page per course:

- **The roster** — who is on it, filterable to one cohort.
- **Where the class is** — each student's current position and when they were last there.
- **Completion** — how much of the course each of them has done.
- **Where they stall** — solve counts per topic and per exercise across the cohort.

A cliff at one exercise is the single most actionable thing this platform could report,
because unlike everything else on these screens it is not about a student at all: it is
feedback into a content repo.

### What the data model already answers, and what it does not

`byCourse` inverts the key — partition `sk`, sort `pk` — and has had no reader since it was
added. These are the questions it answers in **one query**:

| Partition | Answers | Carries |
|---|---|---|
| `ENROL#<course>` | The roster | The cached name and email on each row |
| `COHORT#<id>` | Who is in an intake | The same cache |
| `LAST#<course>` | Where every student is, and when they were last there | `exercise`, `at` |
| `PROG#<course>#<exercise>` | Everyone who has solved that one exercise | `xp`, `at`, `code` |

`LAST#<course>` is the surprise, and it is the headline of the cohort page: one query gives
the whole class's position *and* their last-active time, with no fan-out at all.

**What no single query answers is per-student completion**, because that is a count over
each student's own `PROG#<course>#…` prefix. Two ways to get it, and the choice is not
close:

- One query per exercise, over `PROG#<course>#<exercise>`. Hundreds of queries for a course
  the size of Data Analyst.
- One query per **enrolled student**, tallied. Tens of queries, and the same tally yields
  per-exercise solve counts as a by-product.

So the cohort view fans out per student, exactly as `getUsers` already does with
`mapLimit`, and for the same reason the user listing does: it is the shape that scales with
the number of people rather than with the size of the catalogue. That function alone has 30
seconds where the others have 10, which is the budget this was left room in.

**No new index.** A third key pattern for this would be a full index build on a live table,
bought to save queries that a few hundred accounts do not make expensive.

The denominator — how many exercises a course has — never reaches the Lambda at all.
`card.json` already carries `exercises`, `coding` and `mcq`, and the client already has the
catalogue. The Lambda continues not to know which courses exist, which is what keeps the
content bucket the one place the catalogue lives.

### Difficulty needs a fact nobody records

**Nothing records a failed attempt.** A `PROG#` row is written when an exercise is solved
and never before it, so from the table "hard exercise" and "exercise nobody has reached
yet" are the same shape. Any chart labelled difficulty would be inferring one from the
other.

What is honestly derivable today:

- **Solve rate against the roster** — how many of the class have finished each exercise.
- **Drop-off position** — where `LAST#<course>` bunches up. A dozen bookmarks parked on one
  topic is a stall, and it is one query.
- **Hint volume per exercise** — the strongest of the three, and it needs one new row
  (below).

Ship those first. **Only add attempt recording if they are not enough**, and price it
honestly when the time comes: every Check press becomes a write, on the student's critical
path, and a per-exercise attempt counter is trivial to add and impossible to remove once a
screen depends on it. If it is added, add it where it answers the question — a counter on
the exercise, not an event per press. The interesting number is "how many tries before this
class got it", not an audit log.

## Platform

Small, and deliberately not a second CloudWatch. Three things earn a place.

**Publication state.** Which courses the bucket actually holds, when each last published,
which are announced-but-empty. Read from the same `card.json` files the grid assembles
from, so the page shows the truth rather than a report about it.

**The truncation ceiling.** `PAGE` 60 × `MAX_PAGES` 25 is 1500 accounts, and today it
surfaces as a red line that appears only once you are already past it. On a platform page it
can be a fact — this many accounts, this is the ceiling — read before it matters.

**Spend**, which needs its own section.

Alarms, error rates, latency: leave in CloudWatch. A tutor will not read them and you have a
terminal.

### Hint spend, and why the counter that exists cannot be it

`RATE#hint#<day>` counts hints per student per day already — but those rows carry a
**three-day TTL**. They are a rate *limit*, swept by the table's TTL, and they were never
history. Widening the TTL to make them a ledger would give the limit a memory it does not
need and does not want; the two facts want different lifetimes, so they get different rows.

**The ledger.** One row per student, per day, per course:

```
pk = USER#<sub>   sk = SPEND#hint#<day>#<course>     n, in, out, model
```

- **In the student's own partition**, which is not an aesthetic choice: `forget()` deletes
  everything under `USER#<sub>`, so this is deleted with the person. A row keyed
  `pk = SPEND#<day>` would **survive deleting somebody and still name their sub** — a ledger
  that outlives the person it is about is a data-protection problem, not a feature.
- **Tokens and the model, not money.** A cost computed at write time bakes in a rate nobody
  can check later. Priced at read time from one constant, with the consequence stated where
  the constant is: changing the rate re-prices history. For an internal cost view that is
  the honest trade.
- **Nothing new has to be sent.** `hint.js` already puts `course` and `exercise.id` in the
  request body and the Lambda already ignores both — so the ledger and the counter below are
  two writes in one function, with no client change and no new field to plumb.

**Four views, one rule.** One student is one query on their own prefix. Overall, by course
and by cohort are the same fan-out per person the rest of this document commits to, tallied
different ways — and **cohort is joined at read time from membership**, so the hint Lambda
never learns what a cohort is.

### And one row that is not personal

Hint volume per exercise is the difficulty signal, and it is not a fact about a student:

```
pk = HINTS#<course>   sk = <exercise>      n
```

One `ADD` beside the ledger write. One query gives a whole course's hint pressure, exercise
by exercise, which is precisely the "which exercises are hard" question. Being aggregate and
anonymous, it is also the one row here that does **not** get deleted with a person — which
is correct, and worth writing down so nobody later "fixes" it.

## The boundary

**The admin area may read content. It must never write it.**

The moment it grows a "fix this exercise" button, the content → platform direction inverts
and this repo starts holding the thing it exists to keep out. Showing that exercise 3.2.4
stalls the class is the platform's job; fixing it is a commit in the course repo.

This is the rule most likely to rot, because every step towards breaking it looks
reasonable in isolation. It belongs in `CLAUDE.md` next to the others.

## Rules that carry over

Existing decisions the new screens have to keep, all of them already argued elsewhere:

- **An admin may not unmake themselves.** Self-demotion and self-suspension are refused in
  `putUser`, because only the `admins` group can reach that function and there is no way
  back from inside the app.
- **An admin's course list is derived, never enrolled**, and the screens must not imply
  otherwise — see [Already done](#already-done). Nothing may "fix" an admin's empty
  enrolment by writing rows: those would be rows to withdraw on demotion, and rows somebody
  has to remember for every course published afterwards.
- **`preview.js` stubs every method, including the refusals.** `icecore dev --as admin` is
  the only way to see these screens without a pool behind them. A new route with no stub is
  a screen nobody looks at before it ships.
- **Cognito owns identity; the table owns enrolment** — and now cohorts, which are the same
  kind of fact. Nothing new caches something the pool is the writer of.
- **The sub is not the username.** Every `Admin*` call goes through `lookup()`.

## Order I would build it

The ordering principle is **writes before views**. A screen can be built later against data
that exists; it cannot be built at all against data nobody recorded. Cohorts and the spend
ledger are therefore first, not because they are the most useful but because every day
without them is a day of students untagged and hints uncounted.

1. ~~**Cohorts**~~ — done, see below.
2. ~~**The spend ledger and the per-exercise hint counter.**~~ — done, see below.
3. ~~**The route and the shell.**~~ — done, see below.
4. ~~**The person page, with their submitted code.**~~ — done, see below.
5. ~~**The course page: roster, position, completion.**~~ — done, see below.
6. ~~**Where the class stalls.**~~ — done, see below.
7. ~~**View-as**, read-only.~~ — done, see below.
8. **The platform page**: publication state, spend four ways, the ceiling.
9. **Only then** decide whether attempts need recording.

Remote control sits after all of it and behind a channel that does not exist yet.

## Already done

**Step 1, cohorts.** `COHORTS`/`COHORT#<id>` for the cohort and `USER#<sub>`/`COHORT#<id>`
for membership; `POST`/`PUT`/`DELETE` on a new `/api/admin/cohorts` path served by the same
Lambda; the catalogue riding back with the user listing; a `cohort` column and a
whole-file field in the import, with the cohorts it is about to create named before
anything is sent; a picker with inline create in the dialog; a column and a filter group in
the list; `CohortDialog.vue` for rename, archive and delete; the whole of it stubbed in
`preview.js`, including an empty cohort and an archived one, because those are the two
states a membership-derived list could not draw.

The listing reads cohorts and enrolments as one range - `sk BETWEEN 'COHORT#' AND 'ENROL$'`
- so this cost no extra query per person. The fragility that buys is commented at the call
site and in the stack beside the key map: **a sort-key prefix added later beginning with D
or E would arrive in the listing as an enrolment nobody wrote.**

**Step 2, the ledger.** `SPEND#hint#<day>#<course>` in the student's own partition, tokens
and model rather than money, plus the aggregate `HINTS#<course>`/`<exercise>` counter. Both
writes are awaited but their failure is logged and swallowed: the hint is already paid for
and already good by the time they run. No client change was needed - `hint.js` has always
sent `course` and `exercise.id`, and the Lambda had always ignored them.

Nothing reads either yet. That is deliberate: the screens can be built later against data
that exists, and could not be built at all against data nobody recorded.

**Step 3, the route and the shell.** `route.js` is the one definition of where you are:
`#/admin`, `#/admin/<section>`, `#/admin/<section>/<id>`, parsed in one regex, every
navigation a `pushState` so Back always means one step back. `AdminPanel` stopped being a
boolean over the course grid and became a shell with a `SECTIONS` list, and `CohortDialog`
became `CohortList`, a section rather than a modal — the difference being that a section is
a place you can *be*, which a dialog cannot hold and a URL cannot name.

- **A route is a request, not a permission.** `route.js` knows nothing about who is signed
  in; `App.vue` honours it in one place, so a student who types `#/admin` is turned away
  once rather than in every screen that reads a section name. The correction is a *replace*,
  not a push - it was not a step they took, so Back must not walk into it.
- **The nav draws only where there is a choice.** Courses and Platform are not in `SECTIONS`
  because a tab with no screen behind it is an announcement of work not done. Adding them is
  an entry in that list.
- **`#/admin/people/<sub>` is real today**, opening that person's dialog - so step 4 changes
  what is drawn rather than how it is addressed. Watched rather than read once, because on a
  deep link the route arrives before the listing does.

**Step 4, the person page.** `PersonPage.vue`, and `getPerson` behind
`GET /api/admin/users?sub=` and `?sub=&course=` - three GETs on one path told apart by what
they carry, the idiom the progress function already uses, so this needed no new route.

- **No new writes at all.** The student's own source has been on every `PROG#` row since
  progress was recorded; the only thing missing was a reader other than that student.
- **Summarised across every course they have TOUCHED, not every course they are on.**
  Somebody unenrolled keeps their progress, and a page listing current enrolments would
  report a student who had done nothing.
- **The `BETWEEN` range trick was deliberately not reused.** `LAST#` and `PROG#` are
  adjacent too and it would work. It buys one query per person across the whole pool on the
  slowest screen in the app; this is one person on demand, so the fragility would be paid
  for nothing. Two `begins_with` queries, and a comment saying why.
- **Titles come from the course's own `index.json`**, fetched once per course opened, so an
  exercise is called here what it is called in the player. A withdrawn course still draws
  its list, without them.
- **Code is capped per course and says `clipped`.** A row holds up to 60KB and a course
  hundreds of rows; half a picture returned silently would read as exercises solved with
  nothing saved beside them, which is a real state and must stay distinguishable.
- **The dialog kept adding and editing**, opened from the page rather than by the URL - so
  it is state beside the route rather than part of it, and Back from a dialog does not mean
  something different from Back anywhere else.

**Step 5, the course page.** `CoursePage.vue` and `getCourse`, behind
`GET /api/admin/users?course=` - the fourth GET on that path and still no new route.

- **`byCourse`'s first reader, two partitions at once.** `ENROL#<course>` is the roster in
  one query with the cached names on it; `LAST#<course>` is every student's position *and*
  their last-active time, also one query and no fan-out. Only completion fans out, one query
  per enrolled student.
- **Completion travels beside position, never instead of it.** A bookmark is not a
  completion flag: somebody who finished last month is parked on the final exercise, which
  reads exactly like somebody stuck on it. A student who has solved everything is drawn as
  finished, and the count is what tells those two apart.
- **The cohort filter is here rather than a cohort page carrying a course filter.** They are
  one fact pivoted two ways and building both is two screens maintaining one answer. This is
  the pivot a tutor starts from: they teach a course, and the intake narrows it. That
  settles the open question this plan had about a cohort page - it comes only if it earns
  itself later.
- **Sorting by least recently active puts never-started first**, because that ordering
  answers "who has stopped" rather than "who is behind", and never having begun is the most
  interesting value of that column rather than the least.
- **The response carries a per-exercise solve tally that nothing reads yet.** Unlike the
  index, this could have been added later at no cost; it rides along because it is three
  lines of a loop that was already running, and it makes the stall view a client change.

**Step 6, the stall view.** `CourseStalls.vue`, a second view on the course page, plus one
query on `HINTS#<course>` in `getCourse`.

- **A low solve count is not a stall.** Counts fall away through a course because people
  work in order, so the last exercise is always the least solved and that says nothing. The
  signal is a *drop* relative to the exercise before, and the threshold scales with the class
  so two people moving on is not a cliff.
- **Hints are ranked per solve, not outright**, or the answer is always whichever exercise
  the most people reached. This is the only signal here independent of position, and the
  only thing that separates "hard" from "not reached" - because nothing records a failed
  attempt.
- **Slides are in the list**, because a bookmark on a topic's slides is where most topics
  start: leaving them out made a class sitting on a video read as sitting nowhere. They
  carry a position and no solve count, and `prev` carries across them - a zero between two
  exercises would read as everybody falling off a cliff and climbing back up it. Built
  through `walkTopic`, the one definition of that order.
- **THE STEP 5 TALLY WAS THE WRONG SHAPE AND IS GONE.** It counted solves per exercise
  across the whole roster, so the moment the screen filtered to a cohort it answered a
  different question from the rows beside it - silently. The API now sends *which* exercises
  each student solved, so every tally is of exactly the students being shown and the count
  is `.length`. No extra query; about 90KB for a class of thirty on a 376-exercise course,
  which is the right trade at this scale and would not be at ten thousand.

  Worth keeping as the argument against shipping data before something reads it: the field
  cost nothing to add and was wrong in a way only a reader could have found.

**Step 7, view-as.** `subject.js`, `WatchBanner.vue`, `#/watch/<sub>`, and `enrolled` added
to `getPerson`.

- **One grep settled the shape.** `App.vue` is the *only* reader of `progress.js` - all four
  calls are there and every component below takes props. So the player was already rendered
  from a single subject holder, and this was those four calls taking a subject rather than
  implying one.
- **`me()`, `watching(sub)`, and later `driving(sub)`** — one interface, no call sites in
  between. Remote control is the third implementation rather than a branch anywhere.
- **The write gate went on the SUBJECT, not the API layer**, which this plan had said. The
  thing deciding what is read must be the thing deciding what is written, or the two can
  disagree about whose session this is - and a mismatch there means reading one student
  while recording against another.
- **No new endpoint for the reads.** `admin/users?sub=&course=` was written for the person
  page and already returns exactly what `load` gives back.
- **Nothing touches localStorage.** A watched session hydrated through `progress.js`'s
  offline fallback would overwrite the admin's own record with a student's, silently and
  permanently. It is held in memory and forgotten on exit.
- **The grid is filtered to the student's enrolments**, which is why `getPerson` now returns
  them: a view of a student showing the admin's whole catalogue is a lie about the one thing
  the feature exists to show.
- **The subject is switched BEFORE the courses load** on a deep link. The other order
  fetches the admin's own progress, draws it, and replaces it - a flash of the wrong
  person's work on the screen that must never show one.
- **Running code still works and records nothing.** The editor and its database are local to
  the browser, so trying the student's query against the student's exercise is most of why
  you opened it; only `mark` and `remember` are inert.
- **The banner is the feature.** Everything under it is the ordinary player, so it is the
  only thing distinguishing a student's work from your own - persistent, naming them, and
  saying that nothing is being recorded. Mistaking your own work for someone else's is
  confusing; mistaking theirs for yours is worse.

**And two corrections out of this plan, applied while writing it:**

- **The user list no longer shows an admin's enrolments.** An admin sees every course
  because `App.vue` skips the enrolment filter for them, so listing two courses beside
  their name stated a limit that is not one — and a promoted student appeared to have lost
  the rest of the catalogue. The column reads "All courses"; the ticks in the dialog stay,
  editable, because they are what the person is left on if their rights are removed, with a
  line saying exactly that.
- **`icecore-stack.js` said `PROG#<course>#<unit>`** in the comment documenting the table's
  keys; the Lambda writes `PROG#<course>#<exercise>`. Drift in a comment, now fixed.

## Open questions

- **Whether a cohort should be able to carry a default course.** Argued against above: it
  makes cohort a second spelling of enrolment. But if every real intake turns out to do
  exactly one course, the pivot on the course page is a click somebody makes every time.
  Revisit after the first two intakes, with evidence rather than now.
- **What the cohort page shows that the course page does not.** Its honest answer today is
  "the same numbers, grouped the other way". That is enough to build it, and not enough to
  build it first.
