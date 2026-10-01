import { run, runScratch } from './db.js';
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
  let actual;
  try {
    actual = ddl ? await runScratch(course, dataset, setup, submission)
      : await run(course, dataset, submission, setup);
  } catch (e) {
    /* A STOP IS NOT AN ANSWER. The student ended the query themselves, so there is no
     * verdict to give and no attempt to record; the caller says what happened. */
    if (e.stopped) throw e;
    /* `error` marks this as the query having FAILED rather than having been wrong, which
     * is a distinction the player makes: a wrong answer is ordinary progress, a broken one
     * is where Ask AI offers itself. Both are `pass: false` and only this knows which. */
    return { pass: false, error: true, reason: cleanError(e.message) };
  }

  return compareResults(expected, actual);
}

const cleanError = m => String(m).replace(/^error:\s*/i, '').split('\n')[0];
