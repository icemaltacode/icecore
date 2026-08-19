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

## The content contract

A course repo supplies:

```
content/
  exercises/<unit>/_unit.json     { unit, title, course, courseTitle, topic }
  exercises/<unit>/NN-slug.md     one exercise: frontmatter + markdown sections
  data/<table>.sql                CREATE TABLE + INSERTs
  slides/<unit>/                  optional: a built slide deck for that unit
  courses.json                    importer-only: source slug -> ICE unit mapping
```

### Exercise types

`type:` in the frontmatter picks the player. `coding` is the default and the only one that
touches a database.

**`mcq`** — `## Options` as a numbered list, the right one marked `← correct`, with an
optional `## Feedback` list in the same order.

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
dist/slides/<unit>/                       decks, copied through as-is
```

### Slides

A unit has a deck when `content/slides/<unit>/index.html` exists — derived from what's on
disk rather than declared, so the two can't disagree. The player then offers a **Slides**
button that opens the deck beside the exercise. Set `slides:` in `_unit.json` to an absolute
URL to point somewhere else instead.

Decks land at the site root, not under `content/`, because a built deck is a small site of
its own with absolute asset paths. Build them with a matching base:

```
slidev build unit-1.2.3.md --base /slides/1.2.3/ --out content/slides/1.2.3
```

Note the player links `slides/<unit>/index.html`, not the bare directory: S3 behind
CloudFront applies its root object only to the root, so a directory URL 404s in production.

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

`templates/publish.yml` is a GitHub Actions workflow to copy into a course repo as
`.github/workflows/publish.yml`. It verifies, builds, and syncs content and decks to S3 on
every push that touches `content/` or `slides/`.

It authenticates by OIDC — there is no access key in any repo — and assumes a role that can
write objects and invalidate the CDN, nothing more. **Content publishing never runs
`cdk deploy`**: fixing a typo in an exercise must not be able to touch infrastructure.

The workflow needs `icecore` resolvable in CI, so a course repo should depend on
`"icecore": "github:icemaltacode/icecore"` rather than `file:../icecore` once it is
publishing — and its `package-lock.json` has to be regenerated to match, or `npm ci` refuses
to run. It builds the decks before the content, because `content/slides/` is generated and
absent from a fresh checkout; skip that and the publish quietly succeeds with no slides. The four repository variables it expects are listed at the top of the file, and
all four are stack outputs.

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
