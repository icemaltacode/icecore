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
  courses.json                    importer-only: source slug -> ICE unit mapping
```

and `icecore build` produces:

```
dist/content/courses.json                 manifest of published courses
dist/content/<course>/index.json          units + exercises + expected results
dist/content/<course>/data/<table>.sql    datasets, fetched on demand
```

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

**Reference solutions are never shipped.** `icecore build` strips `solution` from the
output. A determined student can still read the expected *results* from the network tab —
unavoidable for client-side grading — but not the answers.

### What this deliberately doesn't do

It can't tell *how* an answer was reached: `SELECT DISTINCT author` and a `GROUP BY` that
returns the same rows both pass. DataCamp's SCTs check the query's syntax tree for this, and
where it matters the intent is preserved in each exercise's `checks:` frontmatter. Nothing
enforces them yet — that's the next piece of work if it turns out to matter pedagogically.

## Deployment

`icecore bundle` output is entirely static; S3 behind CloudFront is the obvious host.

Two things to get right before it's student-facing:

- **Don't publish the content bucket.** Course content is licensed for ICE's teaching, not
  for public download. Put the app behind ICE login and serve content from a private origin
  or signed URLs.
- **Version the content path** (`<course-id>/<version>/`) so a cohort mid-course doesn't get
  content changed underneath them when you fix a typo.

## Layout

```
app/          the player - Vue 3, CodeMirror, PGlite
  src/compare.js    pure result-set comparison, shared with the CLI
bin/          the icecore CLI
src/build.mjs the content builder
```
