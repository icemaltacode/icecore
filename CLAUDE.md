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
- Run `icecore verify` against a real course repo after touching the builder or the grader.
  It's the only end-to-end check.
