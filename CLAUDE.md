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
  `app/vite.config.js`, so the same app builds against any course repo.

## The shape of a course

**Course > Module > Unit > Topic > exercises**, numbered `1` / `1.1` / `1.1.1`. One content
repo is one course. Only topics are directories and only topics hold exercises; the levels
above exist so a few hundred exercises stay navigable.

Use these words exactly -- a fourth vocabulary is how the old model ended up calling a unit
a course and a topic a unit. Importing from DataCamp: their *track* is a module, their
*course* is a unit, their *chapter* is a topic.

## Embedded apps

A prompt can host a self-contained static app: a line reading `::app <name>::`, optionally
`::app <name> height=720::`, renders an iframe. The app is a directory beside the exercise
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
