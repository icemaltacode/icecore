# Pending Stuff

## Infrastructure (CDK)

The CDK app lives in `infra/`, JavaScript to match the rest of the repo. `just infra-synth`
passes; nothing has been deployed. Everything reaches students through **one** CloudFront
distribution — the app at `/`, the API at `/api/*`, content at `/content/*` and decks at
`/slides/*` — which is what makes the API same-origin, so there is no CORS to configure and
the session endpoint can set cookies that content requests will actually send.

- [ ] **Custom domain** via Route 53 + ACM. Not wired: the stack works on the CloudFront
      domain, and the session Lambda signs for whatever host it was called on, so adding a
      domain later needs no code change.

- [ ] Check cognito invite email does not go to spam after the above change.

## Publishing pipeline

- [ ] **A platform change needs the course repo's lockfile refreshed.** npm pins a git
      dependency to a commit, so CI keeps installing whatever `package-lock.json` names
      however many times the platform is pushed. `npm update icecore` in the content repo
      after any platform change that CI needs. Refreshed to `4391667` (the course grid); the
      platform has moved on since — sidebar, top bar, themes, the resume Lambda — so it
      needs another before the next publish.

## Platform

- [ ] Embedded App Height.
Auto-height for embedded apps

::app <name> height=NNN:: renders a fixed-height iframe. The height is authored by hand, which means it's a guess, and the failure mode is silent: an app that crops loses the chart the question asks about, and the exercise still looks fine.

Make the height a floor rather than an exact value, and make it optional.

The frame is same-origin (see the comment in md.js — allow-same-origin is required, not incidental), so the parent can measure iframe.contentDocument.documentElement.scrollHeight directly. No postMessage, no change to the bundles. Keep a ResizeObserver on the inner <body>: several of these apps redraw on a slider or a tab click, so a one-shot measurement on load isn't enough.

The catch, which is the whole reason this needs care. Sixteen of the twenty-two set minHeight: "100vh" on their root — all of 1.10 and 1.11, none of 1.7. Inside an iframe 100vh is the frame's height, so measurement is circular: set the frame to 900px and the app reports ≥900px regardless of content. It can grow, never shrink.

Same-origin means you can neutralise that before measuring, and I'd advise against it. Those apps were built to fill DataCamp's exercise pane; if their internal layout gives the chart flex: 1, removing the floor collapses the chart instead of fitting it. A collapsed chart is worse than empty space.

So: max(measured, authored). Apps that size to content (the 1.7 six) fit exactly. Apps that want the viewport keep the authored height and grow past it if their content genuinely exceeds it. The authored numbers stop needing to be right and only need to be not-too-large.

height= should become optional — no attribute means measure-only, with a small default floor.

Files: the ::app rule in app/src/md.js, plus resize logic in whichever component owns it. Note the rule currently emits a static style="height:Npx" on .appframe, so the height needs to become something the component can update after mount. .appframe styling is in styles.css.

Ownership: you were last in md.js, so it's yours — I'll keep out of it. Content side needs nothing; the 22 ::app lines work unchanged either way.

## UX

- Are we actually tracking XP?

- Icons are ugly


---

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
