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
 *   driving(sub)  later: reads fed by a channel, writes going through as the student.
 *
 * Remote control is the third of those, and adds no call sites. See ADMIN.md.
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
