# Pending Stuff

## UX

- [ ] **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

## Admin

- [x] A user management screen. Add/remove/edit users.
  - [x] Option to tick which courses to auto-enrol users into when adding.
  - [x] CSV import option with template download.
  - [x] Option to promote users to admin.

- [ ] **No progress reporting.** The users page says who is on a course and whether they ever
  signed in; it cannot say how far anyone has got. The rows are there (`PROG#<course>#<id>`),
  and `byCourse` answers a whole course in one query - which is what that index is being
  kept for. Nothing reads it today; the users page asks each person for their own enrolments,
  because listing by course would mean this side of the wire knowing which courses exist and
  the catalogue is assembled from `card.json` in the bucket.
