/* Student progress, and the XP it earns.
 *
 *   GET  /api/progress?course=<id>   -> { solved: [exerciseId], last, xp, code }
 *   GET  /api/progress?since=<ISO>   -> { xp }   earned since then, across every course
 *   PUT  /api/progress               { course, exercise, solved, xp, code }   mark one done
 *   PUT  /api/progress               { course, last }                         remember the place
 *
 * The two PUT shapes are told apart by which field is present, not by a mode flag: one
 * carries `exercise`, the other `last`, and neither is meaningful in the other's call. The
 * two GETs the same way: one names a course, the other an instant.
 *
 * Keyed on the caller's own Cognito sub, never on anything the request supplies, so one
 * student cannot read or write another's progress however the call is shaped.
 *
 * XP IS RECORDED ON THE ROW, in `xp`, at the moment the exercise is solved. This function
 * could not sum it any other way: the catalogue lives in the content bucket, assembled from
 * every card.json in it, and nothing here knows which courses exist or what an exercise is
 * worth - the same reason the admin listing queries per user. Recording it is also what
 * makes a per-course XP figure one query away for the admin panel's later pages, and what
 * stops a re-tuned `xp:` restating what everyone earned before the change.
 *
 * The amount comes from the client, which is fine: it already asserts that the exercise was
 * solved at all, the reference solution ships to the browser, and these assessments are
 * formative. `amount()` caps it so a bug on that side cannot write a nonsense total, which
 * is the only thing worth defending against here.
 *
 * `at` is written ONCE - `if_not_exists` - so re-solving something does not move the earn
 * into today. That is what makes the daily total honest, because the daily total is derived
 * from these rows rather than kept as a second counter beside them.
 *
 * THE PUT WRITES ONLY THE FIELDS IT CARRIES. A re-solve sends the code without an amount,
 * and the amount already on the row stands - see progress.js. So the update expression is
 * assembled from what arrived rather than being one fixed statement with defaults in it,
 * because a default here is a number nobody meant overwriting one somebody earned.
 *
 * `code` is what solved the exercise, keyed by step - the student's own answer, kept so
 * that coming back to something they finished shows their work rather than a blank editor.
 * Capped, because it is text from a client and a row has a hard 400KB limit it must never
 * be the thing that reaches.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/* A whole number of XP, and not an absurd one. Anything unreadable is worth nothing rather
 * than failing the call: the solve itself is the thing being recorded, and refusing to
 * record it because the amount beside it was malformed loses the more important fact. */
const CAP = 10000;
const amount = xp => Math.min(CAP, Math.max(0, Math.round(Number(xp) || 0)));

/* A submission per step, and nothing else: keys are step indices, values are source.
 * Anything longer than a very long answer is dropped rather than truncated - half a query
 * restored into an editor is worse than an empty one, because it looks like work that was
 * lost rather than work that was never kept. */
const STEP_LIMIT = 20000, TOTAL_LIMIT = 60000;
function submissions(code) {
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

const xpIn = items => (items || []).reduce((n, i) => n + (Number(i.xp) || 0), 0);

/* Every page of a query, not just the first. A student's partition is small, but "small"
 * is not something a total should quietly depend on: a truncated page here would read as
 * exercises un-solving themselves. */
async function queryAll(params) {
  const items = [];
  let start;
  do {
    const r = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: start }));
    items.push(...(r.Items || []));
    start = r.LastEvaluatedKey;
  } while (start);
  return items;
}

export async function handler(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub) return json(401, { error: 'not signed in' });

  const method = event.requestContext.http.method;
  const pk = `USER#${sub}`;

  if (method === 'GET') {
    const course = event.queryStringParameters?.course;
    const since = event.queryStringParameters?.since;

    /* XP earned since an instant, over every course at once - the top bar's daily counter.
     * The instant comes from the browser because only the browser knows when the student's
     * day began; a UTC midnight would roll the counter over at 2am in Malta. Filtered
     * rather than indexed: this walks one student's own rows, and a second index to answer
     * one number on one screen is a full index build on a live table. */
    if (!course && since) {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        FilterExpression: '#at >= :since',
        ExpressionAttributeNames: { '#at': 'at' },
        ExpressionAttributeValues: { ':pk': pk, ':sk': 'PROG#', ':since': since },
      });
      return json(200, { xp: xpIn(items) });
    }

    if (!course) return json(400, { error: 'course or since is required' });
    // Two reads rather than one: the place-marker deliberately sits outside the PROG#
    // prefix, so that a Query for solved exercises cannot pick it up and count it as one.
    const [items, place] = await Promise.all([
      queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': `PROG#${course}#` },
      }),
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: `LAST#${course}` } })),
    ]);
    const id = i => i.sk.split('#').slice(2).join('#');
    return json(200, {
      solved: items.map(id),
      last: place.Item?.exercise || null,
      xp: xpIn(items),
      // Only the rows that have one, so an exercise solved before any of this existed is
      // absent rather than present and empty - which the editor would restore as a blank.
      code: Object.fromEntries(items.filter(i => i.code).map(i => [id(i), i.code])),
    });
  }

  if (method === 'PUT') {
    const { course, exercise, solved = true, last, xp, code } = JSON.parse(event.body || '{}');
    if (!course) return json(400, { error: 'course is required' });

    // Where they were, so the next visit resumes instead of restarting. One row per
    // course, overwritten - it is a bookmark, not a history.
    if (last) {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk, sk: `LAST#${course}`, course, exercise: last, at: new Date().toISOString() },
      }));
      return json(200, { ok: true });
    }

    if (!exercise) return json(400, { error: 'exercise or last is required' });
    const sk = `PROG#${course}#${exercise}`;
    if (!solved) {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
      return json(200, { ok: true });
    }
    /* An update rather than a put, for `at` alone: the row has to keep the moment the
     * exercise was FIRST solved, or a student re-running something they finished last week
     * would see it counted in today's XP. `at` is a DynamoDB reserved word, and `code` may
     * become one, hence the names throughout. */
    const sets = ['#course = :course', '#exercise = :exercise', '#at = if_not_exists(#at, :now)'];
    const names = { '#course': 'course', '#exercise': 'exercise', '#at': 'at' };
    const values = { ':course': course, ':exercise': exercise, ':now': new Date().toISOString() };

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

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk, sk },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
    return json(200, { ok: true });
  }

  return json(405, { error: `${method} not allowed` });
}
