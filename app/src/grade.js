import { scratch, run, runOn } from './db.js';
import { compareResults, isDDL } from './compare.js';

export { compareResults, isDDL };

/** Run the student's query and grade it against the result computed at build time.
 *  Takes the whole exercise because the dataset and its setup SQL travel together. */
export async function grade(course, exercise, step, submission) {
  const { dataset, setup } = exercise;
  if (!submission.trim()) return { pass: false, reason: 'Write a query first.' };
  const expected = step.expected;
  if (!expected) return { pass: false, broken: true, reason: 'No expected result for this step - run npm run content.' };

  // A submission that changes the database gets a throwaway copy, so a failed
  // attempt can't leave the student's own session broken.
  const ddl = expected.ddl || isDDL(submission);
  const db = ddl ? await scratch(course, dataset, setup) : null;
  let actual;
  try {
    actual = db ? await runOn(db, submission) : await run(course, dataset, submission, setup);
  } catch (e) {
    return { pass: false, reason: cleanError(e.message) };
  } finally {
    await db?.close().catch(() => {});
  }

  return compareResults(expected, actual);
}

const cleanError = m => String(m).replace(/^error:\s*/i, '').split('\n')[0];
