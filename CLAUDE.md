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

**Reference solutions must never reach the browser.** `build` strips `solution` from the
output and `verify` builds in memory, so answers don't land on disk either. If you add a
code path that ships exercise data, check it doesn't reintroduce them.

## Gotchas

- `@electric-sql/pglite` must stay in `optimizeDeps.exclude` — it ships wasm and breaks if
  pre-bundled.
- Booting a PGlite instance is slow (seconds in Node). That's why expected results are
  precomputed at build time rather than graded live; don't reintroduce per-check database
  creation.
- Run `icecore verify` against a real course repo after touching the builder or the grader.
  It's the only end-to-end check.
