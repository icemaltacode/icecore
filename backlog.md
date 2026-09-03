# Deferred

- [x] **Nothing in this repo executed the app.** Everything under `app/src` that is not pure
  had no test of any kind, and three bugs shipped in one day in code that had never once run
  — a missing `nextTick` import that made every `applied()` throw, a slides row built without
  its deck, and `report()` dropping the slide number. Each was invisible to reading; the
  first took a debugging browser to find. Done: `npm test` mounts the player in jsdom against
  the preview API and drives a live session through the channel's own dispatcher, plus a pure
  test of the walk. Six seconds. See the Tests section of [CLAUDE.md](CLAUDE.md) for what it
  covers and, more usefully, what it does not.

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

- [ ] **[TO TEST] A cohort member who is not enrolled on the course being delivered.** Was
  reachable by construction: a cohort was a group of *people* and enrolment was a separate per-person row,
  so nothing stopped an intake taking one course together while one of them was not on it.
  Three answers were on the table — enrol them on the spot, refuse the invitation, or let
  them follow read-only for the hour — and the right one turned out to be none of them.
  **The cohort now carries the courses and enrolment is derived from it**, so the state
  cannot be expressed. Two independent facts that have to agree eventually do not, and the
  moment they did not was in front of a class. See [ADMIN.md](ADMIN.md).
  Worth testing as a model change rather than as a bug fix, because it moved where enrolment
  lives: a student's grid after signing in, the cohort screen's course list, the user
  dialog's derived line, and an import into a cohort that takes nothing. The `ENROL#` rows
  are still in the table and nothing reads them - they are the only copy of the old truth
  until this is confirmed.

- [ ] **[TO TEST] End a live session from the cohort screen.** Today the only End session button is on
  the live screen itself, which is fine until that screen is the thing that is broken - and
  then the session is unendable and holds its cohort's lock until the `ttl` a day later. The
  takeover rule in the Lambda already allows any admin to end a session with nobody connected,
  so the button has somewhere to go; what is missing is the button. Found the hard way, while
  a bug on the live screen made every attempt to end a lesson require waiting it out.
  Done. It also turned out that ending remotely wrote no bookmark at all: `end()` falls back
  to the position the session row carries, and nothing had ever written one - fine while the
  only way to end a lesson was from the screen that knew where it was, useless the moment it
  is ended from anywhere else. The educator's own moves now keep it up to date.

- [ ] **[TO TEST] Sync exercise view with students**. In the live screen, by default, code written by the 
  Educator is not pushed to the students. Deliberately, because the students should be writing 
  their own code. But sometimes the Educator wants to show a solution, and the students should
  see it. So, we need a control in the top-bar (where there's End session), to allow the 
  teacher to turn on "Sync with students" mode, which will push the Educator's code to the students' screens (showing the same caret as when remote controlling).
  Done, as **Share editor** beside End session. See [LIVE.md](LIVE.md). Two things it turned
  out to need beyond the buffer: every push names the exercise it belongs to, because a class
  is never all on the same row and dropping the educator's query into whatever somebody has
  open is vandalism rather than a demonstration; and what the student had written is stashed
  and handed back when it stops, or being shown the answer would cost them their own attempt.
  The student's editor is read-only while it lasts, and moving - which already ends following
  - is the way out.