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

# Bugs


## Severe — all three fixed and confirmed live, 2026-09-09

- [x] **The websocket connection can be unreliable.** A socket can die without saying so — a
  lid, a wifi handover, a NAT that forgets the flow. No FIN arrives, `readyState` stays OPEN,
  `onclose` never fires and `send` succeeds into nothing, so the reconnection `live.js` is
  built around was never triggered at all: the room went quiet indefinitely and only a reload
  fixed it. The heartbeat is a question now rather than a keep-alive — the server always
  answered `ping` with `pong` and nothing was listening — and the browser's own `offline`
  event closes the socket outright, which covers every failure the machine knows about within
  a frame. The band goes yellow and says the connection went rather than that the lesson
  ended, in the half of it that is never hidden on a small screen.

- [x] **Annotation latency, and the strokes that never arrived.** Two faults. Every deck frame
  was its own concurrent API Gateway invocation with no ordering between them, and a drawing
  patch is last-write-wins whole-slide SVG — so a stroke's final frame could land before an
  earlier one and be overwritten by it. That is the three-sided square exactly. The sender
  stamps an order now and the receiver drops what is behind.
  The rest was volume: Slidev hooks drauu's `changed`, which fires per pointer *move*, so an
  annotated slide sent ten frames a second and each one carried the slide's whole drawing
  history and cost two DynamoDB round trips. Both reads are cached, and a frame now carries
  only the stroke being drawn. That last part also fixed a wedge nobody had found: a 24KB cap
  measured against a slide that only grows, so one cursive word froze that slide for the rest
  of the lesson.

- [x] **Vendor the dependencies.** The whole Pyodide distribution — all 356 packages, not the
  24 npm bundles — is at `icecampus.com/pyodide/<version>/`, put there by `just pyodide` from
  the release tarball. PGlite was never a CDN dependency; Vite already bundles its wasm and
  the three contrib extensions into `assets/`. `test/setup-checks.mjs` now refuses any
  `http(s)://` host named anywhere in `app/src`, because this is the kind of property that
  rots by accident — a font, a chart library, an icon set, each added by somebody who was not
  on that network.

## Less Severe, but still bad
- When I'm sharing my editor and I click Run Code or Check Answer, the student's system should also Run Code or Check Answer. 
- In the admin screen, when viewing users, can we see dots to indicate if they're online?
- When code is highlighted in the editor, clicking Run code should only run the highlighted code, not the whole file.
- Is Pyodide (or pgsql) loading and unloading for each exercise? Can't we just leave it loaded once it's loaded?

## Problems in the Python ONEY (and NumPy Module of the Data Analysis Course) — all fixed and live, 2026-09-09

Two of the three were the PLATFORM, not the content, which is worth knowing before the next
one of these is reported: both looked exactly like bad course material from the outside.

- [x] **1.1.2 — the columns are flipped and the units don't match.** They are not flipped.
  Height runs 67 to 83 with a mean of 73.7 and Weight runs 150 to 290 with a mean of 201 —
  inches and pounds, column 0 then column 1, exactly as the instructions say, and
  `np_weight_lb` names its own unit. But `[74, 180]` is a perfectly good 74kg and 180cm to
  anyone who has never used imperial units, and every reader here is one. Imperial is
  load-bearing — 2D Arithmetic multiplies by `[0.0254, 0.453592, 1]` to get metric — so the
  fix is to say so: the columns are named where they are introduced, and **every instruction
  that produces a value now names its unit**, in the bullet and in the comments of both the
  starter and the solution. 24 exercises across ONEY, the Data Analyst course and FIAU, whose
  module 4 is the same material.

- [x] **2D Arithmetic — `FileNotFoundError: 'update.csv'`.** The file was in the bucket the
  whole time. Data files are mounted per module at `/ice-data/<module>` and the mount cache
  was keyed on that DIRECTORY — but the file set belongs to the exercise. "Subsetting"
  declares baseball.csv; "2D Arithmetic", the very next one, declares baseball.csv AND
  update.csv. In that order the directory was already mounted, the first exercise's promise
  came back, and update.csv was never fetched. Open the second one first and it worked
  perfectly, which is why it survived. Keyed per file now, and a failed fetch is evicted
  rather than remembered.

- [x] **1.2.1 — the download link is never generated.** The workbook was written and then
  looked for in the wrong place. A run happens in `cwd or os.getcwd()`, and an exercise with
  no `data:` mounts nothing and is handed the empty string — so the run took place in the
  interpreter's home while the player joined each filename onto `''` and read from the
  filesystem ROOT. The read threw, was swallowed as "gone, or not a plain file after all",
  and a student who pressed Run saw their output and no file. The run reports the directory
  it actually used now. Every existing artefact check missed it because they all pass a
  mounted data directory, where the two paths happen to be the same string; there is one
  without data files now. 
