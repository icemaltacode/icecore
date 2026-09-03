/* Whose progress the player is showing.
 *
 * The player has always rendered one person's progress and never had to say whose, because
 * there was only ever one answer. `App.vue` is the single place that asks - `load`, `mark`,
 * `remember` and `earnedToday` are called there and nowhere else, and every component below
 * it takes props. So showing somebody else's session is not a rewiring job: it is those
 * four calls taking a subject instead of implying one.
 *
 * A VALUE, NOT A MODE, and that is the whole reason this file exists rather than a flag
 * inside progress.js. A flag would mean every call site keeps calling the same function and
 * behaviour changes underneath it - which works exactly until the day a third behaviour is
 * wanted, and is also the shape where a stray write goes to the wrong person. Here the
 * subject is an object the player holds:
 *
 *   me()          the signed-in student, or the admin's own view. Writes are real.
 *   watching(sub) another student, read-only.
 *   driving(sub)  remote control: the same reads, and writes that go through AS the student.
 *
 * Remote control is the third of those, and it added no call sites - which is what the shape
 * was chosen for. See ADMIN.md.
 *
 * THE WRITE GATE IS HERE RATHER THAN AT THE API LAYER, which is a departure from what that
 * plan said. The thing deciding what is read has to be the thing deciding what is written,
 * or the two can disagree about whose session this is - and a mismatch there means reading
 * one student while recording against another.
 */
import { api } from './auth.js';
import { load, mark, remember, earnedToday, progressId } from './progress.js';

/** The ordinary case: this browser's own signed-in student. */
export const me = () => ({
  watching: false,
  load, mark, remember, earnedToday,
});

/* Somebody else's, read-only.
 *
 * NO NEW ENDPOINT: `admin/users?sub=&course=` was written for the person page and already
 * returns exactly what `load` has to give back - which exercises were solved, what they
 * earned, where the bookmark is, and the code that solved each one.
 *
 * NOTHING HERE TOUCHES localStorage. `progress.js` falls back to it and `progress-store.js`
 * writes it, and a watched session that loaded through either would overwrite the admin's
 * own record with a student's - silently, and permanently. It is held in memory for as long
 * as the session is open and then forgotten.
 */
export function watching(sub, who) {
  return {
    watching: true,
    sub,
    name: who?.name || who?.email || '',
    async load(course) {
      const d = await api(`admin/users?sub=${encodeURIComponent(sub)}&course=${encodeURIComponent(course)}`);
      const rows = d.solved || [];
      return {
        // Through `progressId` like every other reader, because an exercise id is a number
        // in index.json and a string everywhere it has been stored.
        solved: new Set(rows.map(r => progressId(r.exercise))),
        last: d.place ? progressId(d.place.exercise) : null,
        xp: d.xp || 0,
        code: Object.fromEntries(rows.filter(r => r.code).map(r => [progressId(r.exercise), r.code])),
      };
    },
    /* Inert, both of them. An admin looking at somebody's work must not solve an exercise
     * as them or move the bookmark they left. Running code is not affected and should not
     * be: the editor and its database are local to this browser, so trying the student's
     * query against the student's exercise is the point of opening it, and only the record
     * belongs to them. */
    async mark() {},
    remember() {},
    /* Not a number this side has. Today's XP is derived from rows filtered by an instant,
     * and the admin route answers per course rather than per day - so rather than invent a
     * zero, which would read as a student who has done nothing today, the top bar is told
     * it is watching and shows nothing at all. */
    async earnedToday() { return 0; },
  };
}

/**
 * Remote control: the same session, and writes that land on the student's rows.
 *
 * READS ARE `watching`'s, UNCHANGED. The educator is looking at exactly what a read-only view
 * would show - the difference is entirely on the write side, which is why this is built from
 * that one rather than beside it. Two independent readers would be two chances to render one
 * student while recording against another, and that failure is silent.
 *
 * THE ROW IS THEIRS AND THE ATTRIBUTION IS OURS. An exercise solved while an educator was
 * driving is the student's progress and the student's XP - it has to be, or being helped
 * would cost them the exercise. What makes it auditable is the `by` the Lambda stamps on.
 *
 * IT GOES THROUGH THE ADMIN FUNCTION, NEVER THE ACCOUNT ONE. That one acts on exactly the
 * caller's sub, and there is no sub parameter in the file - the day somebody adds a `?sub=`
 * there for a good reason, the boundary is gone. See ACCOUNT.md.
 *
 * THE COHORT TRAVELS WITH EVERY WRITE, and it is not decoration: the function reads that
 * session's control row and refuses unless this caller is the one currently driving this
 * student. Being an admin is not enough, and the capability lasts exactly as long as the
 * control does - which the student can end.
 *
 * `earnedToday` stays at nought, from `watching`: it is a number this side does not have, and
 * inventing a zero would read as a student who has done nothing today.
 */
export function driving(sub, who, cohort) {
  const where = `admin/progress?sub=${encodeURIComponent(sub)}`
    + `&cohort=${encodeURIComponent(cohort)}`;
  return {
    ...watching(sub, who),
    driving: true,
    async mark(course, exercise, { xp, code } = {}) {
      await api(where, { method: 'PUT', body: { course, exercise, xp, code } });
    },
    /* Written for the same reason it is written for anyone: an educator who drove somebody to
     * exercise 12 has moved where that student resumes tomorrow. Attributed, so a bookmark
     * nobody can account for does not read as the platform having lost their place. */
    async remember(course, exercise) {
      await api(where, { method: 'PUT', body: { course, last: exercise } });
    },
  };
}
