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


# Current Improvements

1. [x] When adding a new Cohort, give the admin the ability to select one or more courses to be associated with that cohort. These should not be checkboxes, as in the future there will be many courses. Instead, there should be a selectable list, or a two pane list etc.

2. [x] The 'Manage Users' button that appears in the top bar should be renamed to 'Admin'. 

3. [x] When adding a new users, the 'can manage users' checkbox should be renamed to 'Admin'.

4. [x] The checkboxes which appear when editing a cohort from the cohort list should be consistent with the new UI developed for point 1.

5. [x] Move the 'forgot it' link in the login page to under the password field, not above it.

6. [ ] If possible, when the educator highlights code whilst remote controlling or sharing their editor, the students should also see the code highlighted. This is a nice to have, but not critical. Ideally in the same orangey hue.

7. [ ] On narrow screens, the participant list panel overlaps the code editor, in a weirdly transparent way. It should
  7.1: Not be transparent.
  7.2: Collapse when it would otherwise overlap the code editor, and be accessible via the button.

8. [ ] The slides view is currently forced to be a panel on the right. Can we have a button to toggle between this view (which we'll call vertical) and horizontal, where the slides move to a horizontal panel at the bottom of the screen?