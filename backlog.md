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

# Enhancements
- Add a timer button, visible only to the Educator. Educator can set a time to count down, and start/pause/resume/reset. Student see the timer counting down, either in a small timer top-right of the editor, or, if the educator ticks 'prominent', as a panel at the bottom, large.

- Split between chat and participants should be resizable.

- Right now, clicking share editor takes over the student's editor. When the Educator stops sharing, whatever the student had before is shown again. We need to enhance this as follows:
  - When the Educator clicks Share editor, a small modal should come up with a checkbox, ticked by default, [ ] Edit student's main editor. 
  - If ticked, whatever the educator typed after they stop sharing is what's left in the student's editor. 
  - If unticked, a new tab opens up in the editor area. For example, if the editor shows 'script.py', the new tab is titled '[EDUCATOR] script.py'. When the Educator stops sharing, the tab remains, but the student's original work is still visible in the other tab. The new tab should be fully functional. If there is enough horizontal space, the educator's tab should be split screened on the right (collapse the participant and chat sidebar to make space if necessary).

- Highlight UI: Can we add an option so the Educator can highlight a part of the UI for the students? For example, the educator clicks on the 'Slides' button, and it is highlighted prominently for the students... ideally with a flashing arrow, which then disappears after a few seconds. Tell me what this involves and whether we can do it.

# Question
- Is the max length of a chat set?
