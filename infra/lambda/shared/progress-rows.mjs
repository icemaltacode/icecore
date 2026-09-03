/* What a progress write IS, in one place.
 *
 * TWO FUNCTIONS WRITE THESE ROWS AND THERE IS ONE DEFINITION OF THEM. The progress function
 * writes the caller's own; the admin function writes somebody else's, during remote control,
 * attributed. They are the same row and the same rules - `at` written once, the amount only
 * when it is sent, the code capped - and two copies of that would drift exactly where it
 * mattered: a student's XP recorded one way by their own browser and another way by an
 * educator's.
 *
 * It is a plain module rather than a Lambda layer because `NodejsFunction` bundles with
 * esbuild, so an import from here is compiled into each function's own artefact. No layer to
 * version, no runtime resolution, and a change to this file redeploys both.
 *
 * `by` IS THE WHOLE OF THE ATTRIBUTION, and it is the reason this is worth extracting at all.
 * A row written under remote control is the student's progress and their XP - it has to be,
 * or helping somebody would cost them the exercise - so the only thing distinguishing it from
 * their own work is this field. Absent means they did it themselves. Present means somebody
 * was driving, and names them.
 */
import { PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

/* A whole number of XP, and not an absurd one. Anything unreadable is worth nothing rather
 * than failing the call: the solve itself is the thing being recorded, and refusing to
 * record it because the amount beside it was malformed loses the more important fact. */
const CAP = 10000;
export const amount = xp => Math.min(CAP, Math.max(0, Math.round(Number(xp) || 0)));

/* A submission per step, and nothing else: keys are step indices, values are source.
 * Anything longer than a very long answer is dropped rather than truncated - half a query
 * restored into an editor is worse than an empty one, because it looks like work that was
 * lost rather than work that was never kept. */
const STEP_LIMIT = 20000, TOTAL_LIMIT = 60000;
export function submissions(code) {
  if (!code || typeof code !== 'object' || Array.isArray(code)) return null;
  const kept = {};
  for (const [step, source] of Object.entries(code)) {
    if (typeof source !== 'string' || source.length > STEP_LIMIT) continue;
    if (!/^\d+$/.test(step)) continue;
    kept[step] = source;
  }
  if (!Object.keys(kept).length) return null;
  return JSON.stringify(kept).length > TOTAL_LIMIT ? null : kept;
}

/**
 * Apply one progress write to one person's partition.
 *
 * Throws an Error whose message is safe to return; the caller decides the status code, so
 * that "course is required" reads the same from either function.
 *
 * @param sub whose rows these are - NEVER taken from a request body by the function that
 *   writes its caller's own, and always checked by the one that does not.
 * @param by  the admin driving, when somebody else's keystrokes made this happen.
 */
export async function writeProgress(ddb, TABLE, sub, body, by = null) {
  const { course, exercise, solved = true, last, xp, code } = body || {};
  if (!course) throw new Error('course is required');
  const pk = `USER#${sub}`;
  const now = new Date().toISOString();

  /* Where they were, so the next visit resumes instead of restarting. One row per course,
   * overwritten - it is a bookmark, not a history.
   *
   * ATTRIBUTED TOO. An educator who drove somebody to exercise 12 has moved where that
   * student resumes tomorrow, which is a change to their record even though nothing was
   * solved - and a bookmark nobody can account for is the kind of thing that reads as the
   * platform having lost their place. */
  if (last) {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk, sk: `LAST#${course}`, course, exercise: last, at: now, ...(by ? { by } : {}) },
    }));
    return { ok: true };
  }

  if (!exercise) throw new Error('exercise or last is required');
  const sk = `PROG#${course}#${exercise}`;
  if (!solved) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
    return { ok: true };
  }

  /* An update rather than a put, for `at` alone: the row has to keep the moment the exercise
   * was FIRST solved, or a student re-running something they finished last week would see it
   * counted in today's XP. `at` is a DynamoDB reserved word, and `code` may become one, hence
   * the names throughout. */
  const sets = ['#course = :course', '#exercise = :exercise', '#at = if_not_exists(#at, :now)'];
  const names = { '#course': 'course', '#exercise': 'exercise', '#at': 'at' };
  const values = { ':course': course, ':exercise': exercise, ':now': now };

  /* THE WRITE CARRIES ONLY THE FIELDS IT WAS SENT. A re-solve sends the code without an
   * amount, and the amount already on the row stands - a default here is a number nobody
   * meant overwriting one somebody earned. */
  if (xp != null) {
    sets.push('#xp = :xp');
    names['#xp'] = 'xp';
    values[':xp'] = amount(xp);
  }
  const kept = submissions(code);
  if (kept) {
    sets.push('#code = :code');
    names['#code'] = 'code';
    values[':code'] = kept;
  }
  /* Written on every attributed write and never REMOVED by an unattributed one, because the
   * two facts are about different moments: an educator solved this for them, and later they
   * came back to it themselves. The second does not undo the first, and a row that quietly
   * stopped saying somebody had been driving would make the attribution worth nothing. */
  if (by) {
    sets.push('#by = :by', '#byAt = :now');
    names['#by'] = 'by';
    names['#byAt'] = 'byAt';
    values[':by'] = by;
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk, sk },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return { ok: true };
}
