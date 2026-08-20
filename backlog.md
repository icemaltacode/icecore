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

# FOR THE SLIDE MIGRATION AGENT

**Read this before authoring another deck.** You are mid-migration on 2.5; nothing below
invalidates what you have already written, but two of the conventions you have been
following are now contracts the platform *reads*, and breaking them fails a build or, worse,
silently points students at the wrong slides.

## Your section dividers are now load-bearing

The player interleaves. A topic's slides are dealt into its exercises at the section
boundaries, so **Next** walks slides → exercises → slides instead of offering the whole deck
up front. It finds those boundaries by reading your deck:

- `layout: statement` **opens** a section. Its `# Title` becomes the section's name.
- `layout: statement_alt` ("Let's practice!") **closes** it.

Consequences, in the order they will bite you:

1. **A section opened with any other layout is dropped silently.** If a deck needs a
   full-bleed heading that is *not* a section, give it a different layout name. Don't reach
   for `statement` because it looks right.
2. **Order is load-bearing.** Section *n* in your deck is section *n* in `content/raw/`,
   which is where each exercise's `section:` number comes from. Adding, removing, merging or
   reordering a divider re-points exercises at the wrong slides. `icecore verify` catches a
   `section:` that runs off the *end* of a deck — it cannot catch a swap. If you deviate
   from the source chapter's video structure, say so, because the exercises have to move
   with you.
3. **`routerMode: hash` must stay** in every `topic-*.md`. Deep links are `#/<n>` and resolve
   client-side. Drop it and every link 404s in production while continuing to work in dev,
   which is the worst way to find out.
4. Renaming a divider is fine — the title is display text only, matched by position, never
   by string. Keep flagging renames as you have been.

A deck carrying **one extra trailing section** — a "Congratulations!" or "What you've
learned" that no exercise points at — is fine and expected. Eight chapters already end that
way. It simply appears at the end of the topic with nothing after it.

## Building decks has changed

`build:units` is gone from `slides/package.json`. The platform owns deck selection now:

```bash
npm run slides:build                          # every deck
npx icecore slides content --only 2.5.1       # just yours
npx icecore slides content --list             # what would build, without building
```

It resolves each deck's transitive `src:` includes, so it knows that editing
`pages/_unit-2.5.md` affects four decks and editing `pages/_frame-close.md` affects all of
them. **Building decks is no longer a prerequisite of publishing content** — a topic gets its
Slides button from `slides/topic-<topic>.md` existing, not from built output.

## Images: each deck now ships only what it references

Slidev copies all of `slides/public/` into every build, which meant one deck carried every
topic's figures — 84MB and 861 objects for a deck whose own content was 6.4MB. Built decks
are now pruned to the images they actually reference.

- Nothing changes in how you author. Keep referencing `/images/<topic>/<file>`.
- Referencing **another** topic's image still works — the pruner keeps whatever your deck's
  own files ask for, wherever it lives. It just costs those bytes in your deck too.
- The pruner reads both the parsed slides and a plain text scan of your source, so
  frontmatter (`image:`, `background:`) and hand-written `<img>` are both covered. If you
  ever build an image path dynamically at runtime, it cannot see that — don't.

## The theme background is WebP now

`bg_main.png` was 3.8MB and sits behind `title`, `module_title`, `topic_title` and
`unit_title`, so it shipped with every deck. It is now `bg_main.webp` at 522KB. Don't
reintroduce a PNG. **This lives in `ice_slidev` and must be pushed before a course CI build
picks it up.**

## New decks with no exercises yet

Module 2 has decks and no practicals. That is fine and needs nothing from you: a topic with
no `section:` on any exercise simply doesn't interleave, and the deck is still reachable
from the Slides button. Interleaving switches itself on when the ripping agent lands the
exercises.

---

# FOR THE PRACTICALS RIPPING AGENT

## `content/raw/` is load-bearing now — do not prune it

It was scratch input from a one-off conversion. It is now the **only** record of where a
chapter's section boundaries fell, because a `VideoExercise` *is* a boundary and the videos
were dropped on conversion — they became the decks. Keep ripping it for the units that
don't have it yet, and never clean it up.

## Every exercise now carries `section: N`

It sits right after `topic:` and is the ordinal of the video the exercise follows, which is
also the ordinal of the matching `layout: statement` slide in that topic's deck. All 371
existing exercises have been backfilled. Two things keep it true:

- `dc-convert` emits it on anything it writes, via `scripts/sections.mjs`.
- `npx dc-sections content` backfills existing files. Idempotent, joins on the `id:`
  frontmatter — DataCamp's own exercise id, not the filename or title, both of which get
  hand-corrected.

**Run `dc-sections` after any `dc-convert --force`.** A forced re-convert should carry
`section:` on its own, but this is the same standing hazard `### Nondeterministic` has, and
the backfill is cheap insurance. `icecore verify` fails if a `section:` points past the end
of its deck, the same way it fails on a missing figure.

## Three source courses still have no raw data

`intro-to-python-for-data-science`, `intermediate-python` and `data-manipulation-with-pandas`.
Their topics cannot be sectioned until that is pulled, so pulling them is what unblocks
interleaving for module 2 — not authoring the exercises, which will land unsectioned
without it.

## 1.10.4 section 1 has slides and no exercises — decide what to do

`Understanding Data Visualization` chapter 4 opens with **Polar coordinates**, and both of
its exercises are `VisualExercise` — questions about a DataCamp-hosted plot — so conversion
correctly skipped them:

```
-- section 1: Polar coordinates
     2. Pie plots       SKIPPED (VisualExercise)
     3. Rose plots      SKIPPED (VisualExercise)
-- section 2: Axes of evil        -> 2 exercises
-- section 3: Sensory overload    -> 2 exercises
-- section 4: Congratulations
```

The platform handles this gracefully: the walk is driven by the **deck's** sections, not by
which sections happen to have exercises, so students still see the polar-coordinates slides
in sequence. Nothing is broken and nothing is hidden.

But that section teaches something nobody practises. Worth one of:

- author two replacement exercises for it by hand — pie/rose plots are answerable from a
  static figure if one is pulled across, and 1.10 already has figures;
- pull the DataCamp plots as embedded apps (`dc-pull-app`) and convert the originals;
- decide it is fine as read-only material and leave it.

**This is the only topic in the course with the problem**, so it is a decision, not a
pattern. Every other exercise-less section is a trailing "Congratulations!" wrap-up, which
is exactly what it should be.

## Publishing changed under you

- The pipeline is one reusable workflow in `icecore`, called by a twelve-line
  `.github/workflows/publish.yml` in the course repo. Don't edit that caller expecting to
  change behaviour — the pipeline is in `icecore/.github/workflows/publish.yml`.
- Pushes are selective. A content-only push builds no decks; a slides-only push skips
  verify. Run the workflow manually with **force-all** if you ever need everything rebuilt.
- Decks sync one prefix at a time. Never add an `aws s3 sync --delete` against `slides/` as
  a whole — with a partial `dist/slides`, which is now the normal case, it deletes every
  deck that wasn't rebuilt.
