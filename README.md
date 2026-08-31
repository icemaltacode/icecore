# icecore

ICE's practice platform. An exercise player where **Postgres runs in the browser** via
PGlite — no backend, no per-student container, no execution sandbox to secure. The whole
deployment is static files.

This repo is the engine only. It contains no course content and never should: courses live
in their own repos and depend on this one.

## Use it from a course repo

```json
{
  "scripts": {
    "dev":    "icecore dev content",
    "build":  "icecore build content",
    "verify": "icecore verify content",
    "bundle": "icecore bundle content"
  },
  "devDependencies": { "icecore": "file:../icecore" }
}
```

| Command | Does |
|---|---|
| `icecore dev [dir]` | Builds the content, serves the player against it |
| `icecore build [dir]` | Publishes content as static files (`dist/content/`) |
| `icecore verify [dir]` | Every solution must grade itself correct; a wrong query must fail |
| `icecore bundle [dir]` | Builds a deployable site — app + content — into `dist/` |

`dir` defaults to `./content`.

### Working on the player's own UI

`icecore dev` runs the platform **open** — no sign-in, and none of the affordances that
only exist for a signed-in student: the Ask AI button, the enrolment filter, sign-out, the
admin panel. That makes the screens hardest to design the ones you cannot see locally.

```
icecore dev content --as student   # the student's view, fully signed in
icecore dev content --as admin     # ...plus the user management screen
icecore dev content --as signin    # start logged out, at the sign-in screen
```

There is no Cognito, no API and no AWS account behind any of it — `app/src/preview.js`
stands in for the lot. Progress goes to localStorage; Ask AI returns a canned reply that
says so; the user list is in memory and resets on reload. In the `signin` role any password
works, except the literal `temp`, which raises the first-login choose-a-password challenge.

Preview is gated on `import.meta.env.DEV` as well as the flag, so it cannot reach anything
`icecore bundle` produces.

## The content contract

A course repo supplies:

```
content/
  course.json                      { id, title, image?, blurb?, modules: [...] }
  exercises/<topic>/_topic.json    { topic, title, unit, unitTitle }
  exercises/<topic>/NN-slug.md     one exercise: frontmatter + markdown sections
  data/<table>.sql                 CREATE TABLE + INSERTs
  data/module-<n>/*.csv            loose files a Python exercise opens by bare filename
  raw/<source>/chapter-*.json      importer-only: where the topic boundaries came from
  slides/<unit>/                   generated: a built deck, written by `icecore slides`
  courses.json                     importer-only: source slug -> ICE module mapping
slides/
  unit-<unit>.md                   the deck source — this is what gives a unit's topics slides
  pages/*.md                       the slides themselves, pulled in by `src:` includes
  public/images/<unit>/*           figures, referenced as /images/<unit>/...
```

### The shape of a course

**Course > Module > Unit > Topic > exercises.** One content repo is one course.

| Level | Is | Numbered | Example |
|---|---|---|---|
| Course | the whole programme | -- | ICExDataCamp Data Analyst Associate |
| Module | a block of related units | `1` | Introduction to SQL |
| Unit | a subject within a module | `1.1` | Relational Databases |
| Topic | a session's worth of it | `1.1.1` | Databases |

Only topics are directories, and only topics hold exercises. A topic names its unit and unit
title in `_topic.json`; its module is the unit number's first component, so nothing is stated
twice. Module titles come from `course.json`, and a unit whose topics disagree about its
title is a warning rather than a silent pick.

Numbers sort numerically, so unit 1.10 follows 1.9 rather than 1.1.

### The course card

Signing in lands on a grid of the courses a student is enrolled on, one card each.
`course.json` supplies what goes on it:

```json
{
  "id": "icex-data-analyst",
  "title": "ICExDataCamp Data Analyst",
  "image": "cover.png",
  "blurb": "Query, aggregate and join relational data with SQL.",
  "modules": [{ "module": "1", "title": "Associate Data Analyst in SQL" }]
}
```

`image` is a path relative to `content/`, and the file should be **square** — the card
crops to 1:1. Both fields are optional: without a blurb the card is just a title, and
without an image it draws a coloured tile carrying the course's initial, which is a
deliberate look rather than a hole. Naming an image that isn't there fails `verify`, the
same as a missing figure.

Progress on each card is the count of solved exercises over the course total, so a
returning student sees where they are before opening anything. Opening a course puts
`?course=` in the URL — coming back to that tab resumes the course rather than the grid.

### Light and dark

The picker in the top bar offers System, Light and Dark, and remembers the choice. Only two
values ever reach the CSS: `theme.js` resolves System to a concrete `data-theme="light"` or
`"dark"` on `<html>`, which is why `styles.css` writes each palette once and every rule
takes a single selector. The same resolution runs as an inline script in `index.html`,
before the bundle — without it the first paint is the wrong colour and the page visibly
flips.

Everything is a token, including the SQL editor: a CodeMirror `HighlightStyle` emits
ordinary CSS, so `var(--ice-syn-*)` resolves per theme. Two colours are deliberately
literal — the white behind a figure and behind an embedded app, which are drawn for a light
page whatever the player is wearing.

### Getting around a course

The sidebar carries **one topic** — the exercises either side of the one open, the unit and
topic they belong to, and a step either way. Everything else is behind **Contents**, a modal
holding the whole collapsible structure with a filter across every exercise, topic and unit
title. Four hundred exercises in a permanent tree is a wall, not navigation.

It starts collapsed to a rail, and there are two ways it opens. Hovering the edge — or the
rail's `»` — opens it *for now*: unpinned it floats over the exercise rather than taking a
column, so nothing reflows under the pointer, and it closes again when the pointer leaves,
when `«` is pressed, or on a click outside it. The **pin** in its header is the permanent
answer: pinned, it becomes a column of the layout and comes back open on the next visit.
Only the pin is written to storage.

Hover has an open delay and a close delay. Without them the sidebar flickers every time the
pointer crosses that edge on the way to the editor, which it does constantly.

Opening a course for the first time starts at its first exercise; after that it resumes
where the student left off. The place-marker is stored per course beside the progress
record — server-side where there is auth, so it follows them between machines, and in
localStorage otherwise.

(For anyone importing from DataCamp: their *track* is a module, their *course* is a unit,
their *chapter* is a topic.)

### Exercise types

`type:` in the frontmatter picks the player. `coding` is the default and the only one that
touches a database.

**`mcq`** — `## Options` as a numbered list, the right one marked `← correct`, with an
optional `## Feedback` list in the same order.

**Markdown in prompts** covers paragraphs, `-` lists, fenced code, pipe tables,
single-level blockquotes, and inline bold, italic, code, links and images. Deliberately no
headings, numbered lists or nested quotes — an exercise prompt that needs those wants
splitting up.

A table needs a header row and a separator row containing at least one pipe, so a bare
`---` under a line of prose stays prose. Alignment markers parse but do nothing; nothing in
the course needs them. Result sets inside ```` ```sql ```` fences are pipe tables too, and
stay code — the fence rule is tested first, deliberately.

**Figures.** An exercise's images live beside it in `exercises/<topic>/images/` and are
referenced by bare filename:

```markdown
![Venn diagram of the set operators](venn.png)
```

The markdown never names the course or the deployment path; the player resolves the
filename against the topic's image directory. Absolute and `http(s)://` sources are left
alone. Only referenced files are published, into
`dist/content/<course>/images/<topic>/` — under `content/`, so figures sit behind the same
signed cookies as the rest of the course and need nothing added to the deploy.

**A reference with no file behind it fails `verify`.** The prompt still reads plausibly
without its figure and the exercise still grades, so nothing else would ever notice — which
is exactly how five exercises reached production with their diagrams missing.

**Non-deterministic steps.** A step whose result can't be reproduced — anything built on
`now()`, `random()`, and so on — is marked in the step itself:

```markdown
### Nondeterministic

Measured against now(), so the value moves every second.
```

Its values are then not compared: the expected set was computed at build time and the
student's runs minutes or months later, so the two can only ever agree on shape. Column
names and row count are still checked, so a wrong query still fails.

`verify` **fails** a step that uses a volatile call and isn't marked. The marker is
hand-written, so a re-convert can wipe it; without that check, grading would quietly go
strict again and the failures would look like data problems. The nastiest case isn't a step
that fails at once — it's one matching a value precomputed the same day, which goes red at
midnight.

Marked per **step**, not per exercise, and the marker is never inferred from the SQL. `now()` inside a
`WHERE` clause can still yield a fixed result set, and a query containing nothing volatile
can still be non-deterministic. `verify` reports how many steps are graded this way, because
they are weaker checks and shouldn't spread quietly.

**Per-exercise setup.** A `## Setup` section containing a ```` ```sql ```` fence runs on top
of the dataset before anything else, for that exercise only:

```markdown
## Setup

```sql
CREATE TABLE matches_spain AS
SELECT * FROM match WHERE country_id = 21518 AND season = '2011/2012';
```
```

This exists because a shared dataset can't express tables that mean different things in
different exercises — `matches_spain` is all of Spain in one and a single season of it in
another. Setup is applied to a copy of the seeded dataset and dumped once, so every database
the exercise needs starts with its tables already there, and exercises without setup pay
nothing. `verify` reports a failing setup as its own error rather than letting it surface as
every solution in the exercise failing.

**Only a `sql` fence counts.** `## Setup` also carries DataCamp's Python `connect()` line in
most imported exercises; anything that isn't SQL is ignored rather than executed.

A `coding` exercise's steps need not all be queries. **A step with `### Options` is
multiple-choice; a step with `### Solution` is a query** — that's the whole discriminator,
and both kinds can sit in one exercise:

```markdown
## Step 4

Which of these best describes the relationship between `countries` and `languages`?

### Options

1. This is a one-to-many relationship.  ← correct
2. This is a many-to-many relationship.

### Feedback

1. That's right! Belgium has three official languages...
2. Not quite. That would need a country to appear against many languages.

### Hint

- Think about whether either side is limited to one.
```

The exercise keeps its `dataset:` — the editor stays available on a multiple-choice step,
because the question is usually about data the student has just been querying, and a step
with no `### Sample` leaves whatever they were writing alone. `verify` requires every step
to carry exactly one of `### Solution` or `### Options`, and fails on neither or both;
without that a dropped question is invisible, because the exercise's other steps still pass.

**`dragdrop`** — no SQL and no dataset. `mode:` chooses between the two shapes:

```markdown
---
type: dragdrop
mode: order
---
## Instructions
- Drag the keywords into the order they execute in.

## Sequence
1. `FROM`
2. `SELECT`
3. `LIMIT`

## Hint
`SELECT` is written first, but is not executed first.
```

`## Sequence` is the *correct* order; the player shuffles for display, and guarantees it
never deals the answer. Grading is an exact sequence match.

```markdown
---
type: dragdrop
mode: classify
pool: Aggregate Functions
---
## Instructions
- Drag each function into the group it belongs to.

## Zones

### Numerical data only
- `AVG()`
- `SUM()`

### Various data types
- `MIN()`
- `MAX()`
- `COUNT()`
```

`pool:` names the holding area items start in. Every `###` under `## Zones` is a drop
target holding its correct items, and grading is bucket membership — order within a zone
doesn't matter. Item text is markdown, so backticks render as code, and item ids are
derived from the text.

`icecore verify` checks these structurally instead of running anything: at least two items,
at least two zones, no zone empty, and no item or id repeated.

and `icecore build` produces:

```
dist/content/courses.json                 manifest of published courses
dist/content/<course>/index.json          units + exercises + expected results
dist/content/<course>/data/<table>.sql    datasets, fetched on demand
dist/slides/<course>/<unit>/              decks that have been built, images pruned
```

### Slides

A unit has a deck when the course repo has a **source** for one, at
`slides/unit-<unit>.md`. Derived from the source rather than from built output on purpose:
deriving it from `content/slides/<unit>/index.html` coupled the content pipeline to the deck
pipeline, so publishing without rebuilding every deck first quietly shipped a course with no
slides links at all. Set `slides:` in `_topic.json` to an absolute URL to point somewhere
else instead.

Build them with `icecore slides`, which knows where each deck goes:

```
icecore slides content                    # every deck
icecore slides content --since <sha>      # only those a change since <sha> affects
icecore slides content --only 2.3         # just this one
icecore slides content --list             # say what would be built, build nothing
```

`--since` resolves each deck's transitive `src:` includes, so editing
`pages/_frame-module-5.md` rebuilds every deck of module 5 and editing `pages/_frame-close.md`
rebuilds all of them. Anything under `slides/` that isn't markdown — `public/`, the theme,
the lockfile — is shared by every deck and rebuilds the lot.

Each deck ships only the images it references. Slidev copies the whole of `public/` into
every build, which meant one deck carried every unit's figures: 84MB and 861 objects for a
deck whose own content was 6.4MB and 18 images. They are pruned after the build, so
`slidev dev` still sees all of `public/` and no `/images/...` reference in the markdown
changes.

Decks land at the site root, not under `content/`, because a built deck is a small site of
its own with absolute asset paths, and `--base` has to match where it lands. They are
**scoped to their course** — `slides/<courseId>/<unit>/` — because every course numbers its
own modules from 1, so two courses on one site both own a unit `1.1`. `deckPrefix` in
`decks.mjs` is the single definition of that path; `dist/slides/` mirrors the bucket, and
`.built.json` carries the course id so the publish reads the prefix rather than rebuilding
it. Note the player links `slides/<course>/<unit>/index.html`, not the bare directory: S3
behind CloudFront applies its root object only to the root, so a directory URL 404s in
production.

#### Interleaving

A topic **is** one section of its unit's deck: a `layout: statement` slide and the run of
slides under it, closed by the `layout: statement_alt` that follows. The topic's own third
number is the ordinal that selects it, so the second section of `unit-2.3.md` is topic
`2.3.2`. The player opens a topic on that slide range and follows it with the topic's
exercises, so **Next** walks slides → exercises → slides rather than offering a whole
chapter's deck up front.

Deep links need no infrastructure: the decks set `routerMode: hash`, so `#/<n>` resolves
client-side.

`verify` fails if a unit's deck has no section for one of its topics, the same way it fails
on a missing figure — an empty topic is the failure that gets worse the later it is found. A
unit with no deck simply has topics with no slides.

Content is fetched at **runtime**, not compiled into the bundle. Publishing a course, or
fixing a typo in an exercise, is a file upload — no app rebuild. A student downloads only
the course they opened and only the datasets its exercises use.

Open a course with `?course=<id>`. With more than one published, a picker appears.

## How grading works

Result-set comparison, not pattern matching on SQL. The reference solution's output is
computed at build time and stored with the exercise, so checking an answer runs only the
student's query.

- Column count and names must match.
- Row count must match.
- Row order matters only when the solution contains `ORDER BY`; otherwise rows compare as a
  multiset.
- Submissions containing DDL run against a throwaway database copy, so a failed attempt
  can't wreck the student's session.

**Reference solutions are shipped, on purpose.** The exercises are formative, and the
player can reveal the answer on request, so withholding it from the bundle would have
protected nothing while forcing a second private content artifact for the hint service to
read. `icecore build` writes `solution` and `checks:` into `index.json`.

### What this deliberately doesn't do

It can't tell *how* an answer was reached: `SELECT DISTINCT author` and a `GROUP BY` that
returns the same rows both pass. DataCamp's SCTs check the query's syntax tree for this, and
where it matters the intent is preserved in each exercise's `checks:` frontmatter. Nothing
enforces them yet — that's the next piece of work if it turns out to matter pedagogically.

## Publishing from a course repo

`.github/workflows/publish.yml` **in this repo** is the pipeline, and every course repo
calls it. `icecore` is public, so a private course repo can. A course's own workflow is
about twelve lines:

```yaml
jobs:
  publish:
    uses: icemaltacode/icecore/.github/workflows/publish.yml@main
    with:
      aws-role-arn: ${{ vars.AWS_ROLE_ARN }}
      aws-region: ${{ vars.AWS_REGION }}
      site-bucket: ${{ vars.SITE_BUCKET }}
      distribution-id: ${{ vars.DISTRIBUTION_ID }}
```

Pass the variables explicitly — `vars` does not resolve inside a called workflow. This
replaced a template each course copied, which had already drifted.

It is selective. A slides-only push skips verify and the content build; a content-only push
builds no decks. Only the decks a change actually reached are rebuilt, and each is synced to
its own prefix — `aws s3 sync --delete` against `slides/` as a whole would delete every deck
that wasn't rebuilt, so `--delete` is never scoped wider than one deck. Decks whose sources
are gone are reconciled away explicitly. Run it from the Actions tab with **force-all** to
rebuild and republish everything.

It authenticates by OIDC — there is no access key in any repo — and assumes a role that can
write objects and invalidate the CDN, nothing more. **Content publishing never runs
`cdk deploy`**: fixing a typo in an exercise must not be able to touch infrastructure.

**The app has to be deployed first, and that stays manual.** The workflow publishes content
and decks only; `index.html`, the JS bundle and `auth.json` come from `just deploy` in this
repo. Run that once before the workflow is any use — on an empty bucket CloudFront answers
`Access Denied`, which gives no clue that the app is what's missing — and again whenever the
player changes.

The workflow needs `icecore` resolvable in CI, so a course repo should depend on
`"icecore": "github:icemaltacode/icecore"` rather than `file:../icecore` once it is
publishing — and its `package-lock.json` has to be regenerated to match, or `npm ci` refuses
to run. The four repository variables it expects are listed at the top of the workflow, and
all four are stack outputs.

It installs the course's `slides/` dependencies on **every** run, including content-only
pushes that build no decks. That isn't waste: `build` reads the deck sources through
`@slidev/parser` to work out each topic's slide range, so without it every topic loses its
slides and `index.json` ships that way — a content push would silently undo what the
previous slides push published.

## Deployment

`icecore bundle` output is entirely static; S3 behind CloudFront is the obvious host.

The one thing to get right before it's student-facing: **don't publish the content
bucket.** Course content is licensed for ICE's teaching, not for public download. Put the
app behind Cognito and serve content from a private origin using CloudFront signed cookies.

Content is deliberately **not versioned** — everyone is on latest, and a typo fix reaches a
cohort mid-course immediately. See [`backlog.md`](backlog.md) for the hosting plan.

## Layout

```
app/          the player - Vue 3, CodeMirror, PGlite
  src/compare.js    pure result-set comparison, shared with the CLI
bin/          the icecore CLI
src/build.mjs the content builder
```
