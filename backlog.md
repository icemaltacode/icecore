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

## Problems in the Python ONEY (and NumPy Module of the Data Analysis Course)
- 1.1.2: Something is wrong with the data. For example, the "Subsetting 2D NumPy Arrays" exercise says to make a new variable np_weight_lb, containing the second column of np_baseball. However, looking at np_baseball, there are two columns, which seem to be weight in kg, and height in centimeters. So 1) The columns are flipped, 2) The units don't match. 
- In the following exercise, 2D Arithmetic, running the code yields: FileNotFoundError: [Errno 44] No such file or directory: 'update.csv'
- 1.2.1 - "Your First Workbook" - a download link for the file is never actually generated. 
