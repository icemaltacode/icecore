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
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
/* THE WRITE ITSELF LIVES NEXT DOOR, because the admin function performs the same one during
 * remote control and two copies of these rules would drift exactly where it mattered - a
 * student's XP recorded one way by their own browser and another way by an educator's. What
 * stays here is who may write, which is the half that must never be shared: this function
 * keys on the caller's own sub and there is no sub parameter in the file. */
import { writeProgress } from '../shared/progress-rows.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

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
    /* `sub` from the CLAIMS and never from the body, which is the whole of this function's
     * boundary. Unattributed, because a write that reached here was made by the person whose
     * rows they are. */
    try {
      return json(200, await writeProgress(ddb, TABLE, sub, JSON.parse(event.body || '{}')));
    } catch (e) {
      return json(400, { error: e.message });
    }
  }

  return json(405, { error: `${method} not allowed` });
}
