# Future Stuff

- [ ] **Remote-control the session of a logged in user** — the student's live screen, both
  cursors visible to both, and navigating on their behalf. Not planned in detail here
  because it needs a channel nothing in the stack has yet. What [ADMIN.md](ADMIN.md) does
  carry are the five constraints "view as" was built under, so that this is an addition to
  it rather than a rewrite of it: `driving(sub)` is a third subject beside `me()` and
  `watching(sub)` in `app/src/subject.js`, and adds no call sites.

# Deferred

Steps 8 and 9 of [ADMIN.md](ADMIN.md). Both are waiting on **data rather than on work** —
neither is blocked, and building either today would produce a worse answer than building it
in a month.

- [ ] **The platform page** — publication state, hint spend overall / by cohort / by course
  / by student, and the account ceiling said out loud before it is reached rather than
  after. The publication half could be built now. The spend half would draw a day of data:
  the ledger began recording on 2026-09-02, so a chart today is three points and a shape
  nobody can read. Waiting costs nothing, because the rows accumulate whether or not
  anything reads them — which is exactly why they were written before any screen for them
  existed.

- [ ] **Decide whether attempts need recording.** Nothing records a failed attempt, so
  "hard exercise" and "exercise nobody has reached yet" are the same shape in the table. The
  stall view is the instrument for deciding: if solve-drop plus hint volume is enough signal
  on real cohorts, this is a write on every Check press that never has to be added — one on
  the student's critical path, and impossible to remove once a screen depends on it. Decide
  it against the screen rather than in advance. If it is added, add a counter on the
  exercise rather than an event per press: the question is "how many tries before this class
  got it", not an audit log.
