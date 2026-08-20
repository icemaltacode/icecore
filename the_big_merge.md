# Requirements from PLATFORM AGENT

## Interleave slides with exercises, at DataCamp's granularity

**Owner:** whoever holds both repos. This spans `icecore` and
`icecore-datacamp-data-analyst` and cannot be done from either side alone.

### Why

Today a topic gets one slide deck and one Slides button. A student either reads all of
1.1.1 up front or none of it, and nothing connects a particular slide to the exercise that
practises it.

DataCamp interleaves. Their 1.1.1 runs:

```
(slides) Databases        MCQ  MCQ
(slides) Tables           MCQ  MCQ  SQL
(slides) Data types       MCQ  MCQ  MCQ
```

We want the same: the relevant slides sitting between the practicals, so Next walks
slides → exercises → slides.

### What I established before proposing this

Four things, all checked against the repos as they stand. Don't re-derive them.

1. **The decks already mark their sections.** Every topic deck uses
   `layout: statement` + `# Title` to open a section and `layout: statement_alt` +
   `# Let's practice!` to close it. All 55 topic decks do this.

2. **`@slidev/parser` is already installed** in `slides/`. `parse()` resolves the `src:`
   includes in `topic-*.md`, so turning a composed deck into
   `[{ title: 'Databases', slide: 3 }, …]` is ~20 lines, not a heuristic over raw markdown.

3. **Deep links already work.** Every deck sets `routerMode: hash`, so
   `…/slides/1.1.1/index.html#/13` resolves client-side. No CloudFront rewrite, no
   `_redirects`, nothing to deploy. This was the expected blocker and it isn't one.

4. **The exercise→section mapping needs no authoring.** `content/raw/**/chapter-*.json`
   still carries the original ordering with the video boundaries intact:

   ```
   1. VideoExercise  "WHERE are the Subqueries?"
   2. NormalExercise "Filtering using scalar subqueries"
   3. NormalExercise "Filtering using a subquery with a list"
   5. VideoExercise  "Subqueries in FROM"
   ```

   A `VideoExercise` *is* a section boundary. All 371 exercises can be assigned
   mechanically.

**The join was measured, not assumed.** Video count vs section-slide count across every
mapped topic: **40 of 42 agree exactly.** The two that don't (1.1.2, 1.2.4) are off by one
for the same reason — the chapter's last video is `"Congratulations!"`, a wrap-up with no
exercises after it. Eight chapters end on a video like that; six of those decks happen to
carry a matching section slide and two don't. Bounded discrepancy, not a systemic mismatch.
Handle it as "a section is a video with at least one exercise after it", and let `verify`
flag any topic where the two sides still disagree.

### Proposed shape

**Content repo**

- At deck-build time, emit `content/slides/<topic>/sections.json`:
  `[{ n: 1, title: "Databases", slide: 3 }, …]` — `slide` being the 1-based index in the
  composed deck, which is what `#/<n>` addresses. Use `@slidev/parser`, not a regex over
  the page files: the `src:` includes shift the numbering and only the parser resolves them.
- Backfill `section: N` into exercise frontmatter, derived from `content/raw/**`. Not typed
  by hand.

**Platform**

- Builder reads `sections.json`, hangs it off the topic, and validates that every
  exercise's `section` resolves to a real slide. `verify` fails otherwise — same treatment
  as a missing figure. A section with no exercises is fine and simply never appears.
- Player interleaves: the flat list gains slide entries at section boundaries; Contents
  shows section headers; slides aren't graded, so they don't count toward progress.

### The one thing I'd argue about

**Don't number them `1.1.1.1`.** That implies a fifth level of the hierarchy, and
`CLAUDE.md` is emphatic that a fourth vocabulary is exactly how the old model ended up
calling a unit a course and a topic a unit.

Model a section as an **annotation on a run of exercises within a topic** — a label plus a
slide range — not as a level that owns exercises. Topics still hold the exercises; sections
just group them. Same interleaved result, no fifth level, and "only topics are directories,
only topics hold exercises" stays true. The internal id is an ordinal within the topic, and
it is never shown to a student either way.

### What the practicals ripping agent needs to know

- **`content/raw/` is now load-bearing.** It was scratch input; it is the only record of
  where the section boundaries were. Don't prune it, and keep ripping it for the units that
  don't have it yet.
- **Three source courses have no raw data**: `intro-to-python-for-data-science`,
  `intermediate-python`, `data-manipulation-with-pandas`. Their topics can't be sectioned
  until that's pulled.
- **`layout: statement` is now a contract, not a style choice.** A deck that opens a section
  with a different layout drops that section silently. If a deck needs a full-bleed heading
  that *isn't* a section, it needs a different layout name.
- **`routerMode: hash` must stay** in every topic deck. Drop it and every deep link 404s in
  production while continuing to work in dev.
- **Frontmatter gains `section:`** on every exercise. Anything that regenerates an exercise
  file — a forced `dc-convert` in particular — has to carry it, the same way it has to carry
  `### Nondeterministic`.

---

# Requirements from PRACTICALS RIPPING AGENT

## Make publishing incremental, and define it once

**Owner:** whoever holds both repos. This spans `icecore` and
`icecore-datacamp-data-analyst` and cannot be done from either side alone.

### Why

Fixing a typo in one slide deck costs **31 minutes** of CI and re-uploads **2.1GB** to S3.
It rebuilds all 38 decks, grades all 414 reference solutions, and re-syncs every object in
the bucket. Nothing about that work is related to the typo.

The pipeline is also defined in two places — `icecore/templates/publish.yml` and a copy in
each course repo — which have already drifted, and a per-deck build would mean maintaining
the deck-selection logic in two places too.

### What I established before proposing this

Measured against the first successful publish (run 32351207786, 31m19s). Don't re-derive
these.

1. **Where the time goes.** Per-step, from the Actions API:

   | Step | Time | |
   |---|---:|---|
   | Publish (`s3 sync` + invalidation) | 790s | 42% |
   | Verify the content | 586s | 31% |
   | Build content | 248s | 13% |
   | Build decks | 214s | 11% |
   | everything else | ~31s | 2% |

2. **Every deck ships every topic's images.** `slides/public/` is 74MB and Slidev copies it
   wholesale into each build. The published `slides/1.5.2/` prefix is **56MB across 465
   objects and contains 27 image directories** — 1.1.1 through 1.10.4 — when its own images
   are a megabyte or two. 38 decks x 56MB is the 2.1GB. Content, by contrast, is 46MB across
   508 objects, apps included. This is the root cause of the Publish step, and it caps what
   any other change can win.

3. **`build:units` is an unconditional glob**: `for f in <deck>-*.md; do slidev build ...`.
   No change detection anywhere.

   **And the deck count is about to rise by half.** The 31-minute run built 38 decks,
   because git HEAD holds 38 `slides/unit-*.md`. The working tree has **59
   `slides/topic-*.md` and no `unit-*.md`** — a rename plus the new 1.11 decks, uncommitted
   at the time of writing, with `build:units` already globbing the new name. The moment that
   lands, the same push builds 59 decks and syncs roughly **3.3GB**, taking the run past 45
   minutes. The output prefixes are unchanged (`unit-1.1.1.md` and `topic-1.1.1.md` both
   build to `slides/1.1.1/`), so nothing is orphaned in S3 — it just gets bigger. Whoever
   commits that rename should expect the slowest publish yet.

4. **"Rebuild only 1.5.2" is not a filename match.** `topic-1.5.2.md` includes
   `pages/_frame-module-1.md` and `pages/_unit-1.5.md` as well as its own page file. Editing
   `_unit-1.5.md` affects four decks; editing `_frame-module-1.md` affects all of them.
   Selective building needs the include graph. (`@slidev/parser` is already a dependency and
   resolves `src:` — see the platform agent's point 2 above; the same parser serves both
   features.)

5. **Two traps make naive selectivity actively destructive.**
   - `build.mjs` decides which units get a Slides button by looking for *built output* in
     `content/slides/<unit>/`. Skip the deck build and the course publishes with no slides
     links at all, silently. The workflow comment already warns about this.
   - `aws s3 sync --delete` against `slides/` with a partial `dist/slides` **deletes every
     deck that wasn't rebuilt**.

6. **Verify and Build content each precompute the same 414 expected result sets** — 834s of
   duplicated PGlite work on every push. Verify additionally grades and runs the negative
   control, which is the extra 338s.

7. **`icecore` is public**, so a private course repo can call a reusable workflow hosted in
   it. This is what makes a single definition possible.

8. **The two copies have already drifted.** `templates/publish.yml` gained a "the app must
   be deployed first" warning on 19 Aug that never reached the course repo.

### Proposed shape

**Step 0 is a prerequisite, not an optimisation.** Nothing below is safe without it.

**0. Decouple the Slides button from the deck build.** Derive it from the *source*
`slides/topic-<unit>.md` existing, not from built output. One line in `build.mjs`, and it is
what makes the content and slides pipelines independent.

**1. One definition — a reusable workflow.** Move the pipeline to
`icecore/.github/workflows/publish.yml` with `on: workflow_call` and typed inputs. Each
course repo keeps a ~12-line caller passing its four variables:

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

Pass the variables explicitly rather than relying on `vars` resolving inside a called
workflow. Delete `templates/publish.yml`. `@main` means course repos can never drift again
but a bad pipeline change breaks every course at once; a `@v1` tag is the safer trade. My
preference is `@main` — this is the pipeline, not the grader, and the grader is already
pinned through the lockfile.

**2. Build only the affected decks.** New platform command,
`icecore slides <contentDir> [--since <sha>]`, which resolves each `topic-*.md`'s transitive
`src:` includes, maps changed paths to affected decks, treats `slides/package.json`, the
lockfile, the theme and `public/**` as global, and shells out to Slidev per affected deck.
The course repo's `slides:build` collapses to `icecore slides .`, so the logic exists once.

Sync then goes **per rebuilt deck**, with `--delete` scoped to that one prefix and never to
`slides/` as a whole, plus a reconciliation pass removing prefixes for decks that no longer
exist. Invalidation narrows to `/slides/<unit>/*`.

**3. Gate the steps on what changed.** Slides-only skips verify and the content build;
content-only skips deck building. Trivial after step 0, dangerous before it.

**4. Separately: publish `slides/public/images/` once.** To `/slides/_shared/images/`,
referenced absolutely — everything is behind one distribution, so absolute paths resolve.
Needs a dev-mode story so `slidev dev` still finds them, which is the fiddly part. Do it
after 0-3: it changes what "publish a deck" means, and that is better changed once the
pipeline is already selective. Takes the site from 2.2GB to under 200MB.

**Worth considering alongside 6 above:** Build content re-does Verify's PGlite work. Having
one produce an artifact the other consumes would remove ~250s from every content push.

### What the platform agent needs to be aware of

- **Step 0 touches `build.mjs`** — the same file as the sectioning work. Coordinate; the
  change itself is one line but it is in your path.
- **`@slidev/parser` serves both features.** Sectioning needs it to find section slides;
  selective building needs it to resolve `src:` includes. Build the include-graph helper
  once and share it rather than parsing decks twice.
- **`sections.json` becomes a build output under `content/slides/<topic>/`**, which is
  exactly the directory step 0 stops treating as authoritative. Make sure the Slides button
  and the sections data don't quietly re-couple: the button should come from source, the
  sections from build output, and a missing `sections.json` should degrade to "no
  interleaving" rather than "no slides".
- **Selective deck builds mean `sections.json` may be stale for decks that weren't
  rebuilt.** That is fine as long as the exercise->section validation in `verify` runs
  against the source decks, not against whatever happens to be in the build directory.
- **CI only works as of 2026-08-20.** The publisher role's trust policy never matched:
  GitHub now issues OIDC subject claims carrying numeric ids
  (`repo:icemaltacode@132367313/icecore-x@1338407739:...`), and STS reports a condition
  mismatch identically to a missing role. Fixed in `ed4419e`; both claim shapes are trusted
  because the rollout appears to be in progress. If publishing breaks again with "Not
  authorized to perform sts:AssumeRoleWithWebIdentity", check
  `GET /repos/{owner}/{repo}/actions/oidc/customization/sub` before suspecting the variables.
- **AWS work needs `AWS_PROFILE=ice`** (account 845106282768). The default profile is a
  different account which also has a GitHub OIDC provider installed, so a wrong-account
  `cdk diff` reports the whole stack as new rather than failing.
