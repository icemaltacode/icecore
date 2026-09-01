# Pending Stuff

- [x] When a user has successfully completed a practical, their solution should still be there if they revisit it later.
  Recorded on the server beside the solve, keyed by step. Re-solving updates the code and does not earn the XP again.

- [x] On screens which aren't too small (let's say 1000px vw and higher), the sidebar should start opened and pinned by default.
  Only when no preference has been stored - a deliberate unpin still wins on the next visit.

- [x] Since the sidebar expands and collapses automatically on hover-in and hover-out, the >> and << buttons have no effect. They should be removed from the UI.
  Gone, along with the `dismissed` state that only the << button set, and the two chevrons in `Icon.vue`.

- [x] Completing an exercise should make the 'Next' button flash (show me variants).
  Halo, looping until the student moves. One definition in `styles.css` - see `.btn.urge`.

- [x] When the user's code results in an error (either through Run Code or Check answer, the Ask AI button should flash to indicate that they can ask for help.)
  The same halo, quieter, cancelled by the first keystroke in the editor. An *error*, not a wrong
  answer: `grade.js` now marks a query that failed to run apart from one that ran and was wrong.

Found while testing the above, both pre-existing and both silent:

- [x] **Progress never survived a reload.** An exercise id is a number in `index.json` and comes
  back from storage as a string, so `solved.has(id)` was always false: a finished course read as
  untouched. One spelling now, `progressId` in `progress.js`.
- [x] **"Resume where you left off" always started at the top.** The same mismatch in the
  place-marker, hidden because a slides row's id is a string this side makes up - so the one case
  that did work was the fallback looking like the feature.

# Future Stuff

- [ ]
