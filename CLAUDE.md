# icecore — working notes

The ICE practice platform. See [`README.md`](README.md) for what it does and how to use it
from a course repo.

## The rule that matters

**No course content in this repo, ever.** The dependency direction is always
content → platform. If something is specific to a course — a unit mapping, a dataset, an
exercise, a DataCamp slug — it belongs in that course's repo, not here.

That's also what keeps `icecore` free of DataCamp-derived material, so it's the one repo
that could be shown externally or open-sourced.

## Architecture

- `app/` — Vue 3 player. `src/compare.js` is pure and dependency-free so the CLI can share
  it; everything else in `app/src/` is browser-only (`content.js` uses `import.meta.env`,
  so Node can't import it).
- `src/build.mjs` — content builder. Parses exercise markdown, precomputes expected results
  by running each reference solution in PGlite, emits per-course static files.
- `bin/icecore.mjs` — the CLI. `root` and `publicDir` are supplied here, not in
  `app/vite.config.js`, so the same app builds against any course repo. `icecore slides`
  also lives here: the platform owns the deck build, so the selection logic exists once.
- `src/decks.mjs` — the **only** place a deck is parsed. One `@slidev/parser` load yields
  both the section ranges the player interleaves with and the transitive `src:` include
  graph selective building needs. Parsing decks twice for the two features is how they
  drift apart.
- `app/src/walk.js` — pure, like `compare.js` and `dragdrop.js`. The order a student moves
  through a topic. `App.vue` and `ContentsModal.vue` both draw it, and the two disagreeing
  reads as exercises going missing.
- `.github/workflows/publish.yml` — the publish pipeline, called by every course repo.
  There is no template to copy any more; the two copies had already drifted.

## The shape of a course

**Course > Module > Unit > Topic > exercises**, numbered `1` / `1.1` / `1.1.1`. One content
repo is one course. Only topics are directories and only topics hold exercises; the levels
above exist so a few hundred exercises stay navigable.

Use these words exactly -- a fourth vocabulary is how the old model ended up calling a unit
a course and a topic a unit. Importing from DataCamp: their *track* is a module, their
*course* is a unit, their *chapter* is a topic.

## Slides, sections and interleaving

**A topic has a deck when `slides/topic-<topic>.md` exists** — the *source*, never built
output. Deriving it from `content/slides/<topic>/index.html` coupled the content pipeline to
the deck pipeline: skipping the deck build then published a course with no slides links at
all, silently. That decoupling is what makes selective deck building safe, so don't undo it.

**A section is not a fifth level.** It is an annotation on a run of exercises within a topic
— a label and a slide range — so topics still hold the exercises and the numbering stays at
three components. `CLAUDE.md` is emphatic that a fourth vocabulary is how the old model came
to call a unit a course; a fifth level would be the same mistake. The ordinal is internal and
never shown to a student.

- A section opens on `layout: statement` and closes on the `layout: statement_alt`
  ("Let's practice!") that follows. **That is a contract now, not a style choice.** A deck
  that opens a section with any other layout drops it silently. A full-bleed heading that
  *isn't* a section needs a different layout name.
- **`routerMode: hash` must stay** in every topic deck. Deep links are `#/<n>` and resolve
  client-side; drop it and every link 404s in production while still working in dev.
- **Slide numbers are composed-deck numbers.** `topic-1.1.1.md` pulls in the module frame,
  the unit frame and its page file, so a regex over the page counts from the wrong place.
  Only the parser resolves `src:`.
- `section: N` on an exercise is derived from `content/raw/**` by `dc-sections` in the
  importer, never typed. **Anything that regenerates an exercise file must carry it** — a
  forced `dc-convert` in particular, the same standing hazard `### Nondeterministic` has.
- The walk is driven by the **deck's** sections, not by which sections have exercises. 1.10.4
  lost both of section 1's exercises to `VisualExercise` on import; driving off exercises
  would silently drop its slides, and every topic's closing section with them.
- `verify` fails if a `section:` points past the end of its deck. A topic with no `section:`
  anywhere simply doesn't interleave.
- **A slide step is walled to its section.** `SlidesStep.vue` clamps the frame's hash to
  `[slide, end]` on `hashchange`, because Slidev's Next walks the whole topic deck and
  paging out of a section skips the exercises interleaved after it. `hashchange` rather than
  the controls: arrows, keys, swipe and clicking a slide in the overview all end up there.
- **Which nav controls a student gets lives in `slidev-theme-ice/styles/nav.css`**, not in
  CSS the player injects. A deck is also watched in a tab, at its published URL, and under
  `slidev dev`; the set has to be the same in all of them. Matched on each button's `title`,
  so a Slidev upgrade that rewords one brings that control back - re-read
  `@slidev/client/internals/NavControls.vue` if one reappears.
- **`@slidev/parser` is resolved from the course's `slides/`**, not from here — it has to
  match the Slidev that builds the decks. So `npm ci --prefix slides` is a prerequisite of
  building *content*, not just of building decks. Miss it and every topic loses its
  interleaving and ships that way without failing.

## Publishing

One definition, in `.github/workflows/publish.yml`, called by each course repo with its four
variables. Pass them explicitly: `vars` does not resolve inside a called workflow.

- **Never `aws s3 sync --delete` against `slides/` as a whole.** With a partial `dist/slides`
  — which is now the normal case — it deletes every deck that wasn't rebuilt. Sync one deck
  prefix at a time and reconcile removed decks explicitly.
- **Each deck ships only the images it references.** Slidev copies all of `public/` into
  every build; that was 84MB and 861 objects for a deck whose own content is 6.4MB. Pruned
  after the build, so `slidev dev` still sees all of `public/` and the markdown is untouched.
  The brief's `/slides/_shared/` idea fights Vite, which rewrites absolute asset URLs against
  each deck's `--base`.
- Remaining per-deck weight is ~6.4MB of assets, **3.6MB of which is the theme's
  `bg_main.png`** — one identical file, ~212MB across the site. That lives in
  `slidev-theme-ice`.
- CI only works as of 2026-08-20. GitHub now issues OIDC subject claims carrying numeric ids
  (`repo:icemaltacode@132367313/icecore-x@1338407739:...`) and STS reports a condition
  mismatch identically to a missing role. Both claim shapes are trusted while the rollout is
  in progress. If publishing breaks with "Not authorized to perform
  sts:AssumeRoleWithWebIdentity", check `GET /repos/{owner}/{repo}/actions/oidc/customization/sub`
  before suspecting the variables.
- AWS work needs `AWS_PROFILE=ice` (account 845106282768). The default profile is a different
  account that also has a GitHub OIDC provider installed, so a wrong-account `cdk diff`
  reports the whole stack as new rather than failing.

## Embedded apps

A prompt can host a self-contained static app: a line reading `::app <name>::`, optionally
`::app <name> height=720::`, renders an iframe. **`height=` is a floor, not a height** -
[`app/src/appframe.js`](app/src/appframe.js) measures the app and grows the frame past it
when the content needs more, so the authored number only has to be not-too-large. Sixteen
of the twenty-two shipped apps do exceed theirs, two of them by ~600px.

Every measurement is taken at the *same* reference height, the floor: set frame to floor,
read `scrollHeight`, write the answer back, all in one task so the reference is never
painted. Measuring at the frame's current height would be circular - these apps were built
to fill DataCamp's exercise pane, so what they report depends on what you gave them, and the
frame walks down the page a few pixels per redraw. Neutralising that instead would collapse
any chart with `flex: 1`. Checked against all 22: every one is a fixed point of the
reference measurement.

The watcher is installed once from `main.js`, not owned by a component: the `::app` markup
is produced by `md.js` and injected with `v-html` from several components and owned by none,
so a future component rendering prose would silently get fixed-height frames again. The app is a directory beside the exercise
at `content/exercises/<topic>/apps/<name>/` with its own `index.html`, mirrored to
`content/<course>/apps/<topic>/<name>/` at build time and shipped whole. `verify` fails on
a reference with no `index.html` behind it, the same way it does for a missing figure.

The iframe is sandboxed, but **with** `allow-same-origin`, and it has to be. Without it the
frame gets an opaque origin, its own assets become cross-origin requests to a host that
sends no CORS headers, and a module script — always fetched in CORS mode, `crossorigin`
attribute or not — can never load at all. Serving CORS headers instead works in dev and
403s in production: `/content/*` is behind the CloudFront key group and an anonymous
cross-origin fetch carries no cookies.

So the sandbox is worth keeping for the rest of its list — no top-level navigation, no
popups, no forms — but it does **not** isolate the app from the player. A mirrored bundle is
first-party code and has to be treated that way: read what it loads before shipping it.
`dc-pull-app` warns when one reaches a DataCamp host at runtime, which is the loudest
version of that check but not the only one worth doing.

It has to be an iframe and not inlined markup: these bundles bring their own framework, their
own stylesheet and their own opinion about what `body` looks like.

## Grading semantics

Result-set comparison, not pattern matching on SQL:

- Column count and names must match; row count must match.
- Row order matters **only** when the reference solution contains `ORDER BY`; otherwise rows
  compare as a multiset.
- Submissions containing DDL run against a throwaway database copy — a failed attempt must
  never leave the student's session broken. (Learned the hard way: grading originally ran
  the reference solution against the student's own database, which the `CREATE VIEW`
  exercise broke immediately.)
- `expected.rows` is capped at 1000; past the cap only columns and counts are checked.
- A step whose solution calls `now()`, `CURRENT_DATE`, `random()` and friends **must** be
  marked `### Nondeterministic`, and `verify` fails if it isn't. The marker is hand-written
  in the exercise, so a forced re-convert can wipe it -- without the check that would
  silently restore strict grading, and the failures would look like data problems. Note the
  worst case is not the step that fails at once but the one that matches a value precomputed
  the same day and goes red at midnight.
- A step marked `### Nondeterministic` is graded on columns and row count alone. Expected
  results are computed at build time, so anything resting on `now()` or `random()` can never
  match later. It is declared per step and never inferred from the SQL -- `now()` in a
  `WHERE` clause may still give a fixed result set, and one step of an exercise being
  unreproducible says nothing about its siblings.

**Not everything is graded by result set.** `dragdrop` exercises have no SQL and no
dataset: they're graded structurally by `app/src/dragdrop.js`, which is pure and shared with
the CLI the same way `compare.js` is. Don't route them through PGlite or give them
precomputed expected results — `verify` validates their *content* instead (every item in
exactly one zone, nothing duplicated).

**Reference solutions ship to the browser, deliberately.** This reversed an earlier rule.
These assessments are formative, not summative, and the player offers a "show answer"
affordance anyway, so hiding the solution bought almost nothing while forcing a private
server-side content artifact and a fatter hint service. `build` writes `solution` and the
`checks:` frontmatter into `index.json`; the hint Lambda gets everything from the client.
Don't re-strip it.

## Gotchas

- `@electric-sql/pglite` must stay in `optimizeDeps.exclude` — it ships wasm and breaks if
  pre-bundled. Every contrib entry point needs its own entry too: `exclude` matches the
  import specifier, not the package.
- **Contrib extensions live in [`src/extensions.mjs`](src/extensions.mjs)** — one list, used
  by all three PGlite call sites and by `vite.config.js`'s `optimizeDeps.exclude`. Adding one
  is a single line there. They must be registered on *every* instance, not just the one that
  seeds a dataset: a data dir dumped with an extension installed still fails to load without
  the wasm module present (`could not access file "$libdir/tablefunc"`).
- Registering an extension also makes it appear in `pg_available_extensions`, with
  `installed_version` set only once `CREATE EXTENSION` has run — so that catalogue reflects
  the list above, not the ~30 a stock PostgreSQL server offers.
- **Don't register all 32 bundled extensions.** Each is emitted as a separate browser asset
  and they total ~2.1MB (pgcrypto alone is 1.1MB), plus ~220ms per instance boot against
  ~45ms for the current three.
- Booting a PGlite instance is slow (seconds in Node). That's why expected results are
  precomputed at build time rather than graded live; don't reintroduce per-check database
  creation.
- **Precomputed results are cached on disk** by [`src/expected-cache.mjs`](src/expected-cache.mjs),
  under the course's gitignored `.icecore/cache/expected/`. Cold that pass is ~218s for the
  Data Analyst course; warm it is ~0.9s, which is the difference between `icecore dev` being
  usable and not. The key is per **exercise** - dataset content, setup, and every step's
  solution and `nondeterministic` flag, plus the installed PGlite version - because steps of
  one exercise share a database and a per-step key would hit on step 3 after step 2's
  `INSERT` changed the rows underneath it. Failures are cached too, and replay goes through
  the same `record()` as a fresh computation so a warm run and a cold run cannot report
  different numbers. `ICECORE_NO_CACHE=1` bypasses it.
- **Signed cookies covering more than one file need a *custom* policy.** Passing
  `dateLessThan` to `getSignedCookies` yields a canned policy, which CloudFront rebuilds
  from `CloudFront-Expires` and the URL being requested — so a signed `…/*` matches nothing
  and every request 403s, with cookies that look entirely correct. Build the policy JSON and
  pass `policy`; the giveaway is whether the cookies carry `CloudFront-Policy` (custom) or
  `CloudFront-Expires` (canned).
- **The session Lambda cannot learn the site's domain from the `Host` header.** `/api/*`
  uses CloudFront's `AllViewerExceptHostHeader` origin request policy — required for an API
  Gateway origin — which replaces the viewer's `Host` with the API's own domain. Signing
  cookies for that host produces cookies that look perfectly valid and make every content
  request 403. The client sends its `location.origin` instead. It can't be an environment
  variable: the distribution depends on the API, which depends on the function.
- **An exercise's `## Setup` SQL has to be applied in both places** — at build time before
  precomputing expected results, and in the player before the student's query runs.
  Build-time only means an exercise that graded fine tells the student the table doesn't
  exist. It's applied to a *copy* of the seeded dataset and dumped, never by booting a
  fresh instance, and everything the player caches downstream of a dataset is keyed by the
  setup too: two exercises on one dataset can define the same table name differently.
- **Only a ```sql fence in `## Setup` is setup.** That section also holds DataCamp's Python
  `connect()` line in most imported exercises. `codeIn` matches any language; `sqlIn` is the
  one to use here.
- **Drag-and-drop item ids must be unique across the whole exercise**, not per zone.
  Grading matches a placement to an item by id, so two zones each owning an `avg` would let
  an item dropped in the wrong zone score as correct in both. `withIds` takes a shared
  `used` map for exactly this, and `validate()` re-checks it as a backstop — the check looks
  redundant and is not.
- **A figure's filename must not contain a space**, and `dc-convert` slugifies on the way in
  for that reason. The image rule and the builder's missing-figure check both tolerate one
  now, but a space used to make the rule miss entirely: the reference fell through to the
  link rule, rendered as a stray `!` in front of a hyperlink, and the check that exists to
  catch a dropped figure skipped it for the same reason. Three of DataCamp's assets were
  named that way.
- Run `icecore verify` against a real course repo after touching the builder or the grader.
  It's the only end-to-end check.
