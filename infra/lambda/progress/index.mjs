/* Student progress.
 *
 *   GET  /api/progress?course=<id>   -> { solved: [exerciseId], last }
 *   PUT  /api/progress               { course, exercise, solved }   mark one done
 *   PUT  /api/progress               { course, last }               remember the place
 *
 * The two PUT shapes are told apart by which field is present, not by a mode flag: one
 * carries `exercise`, the other `last`, and neither is meaningful in the other's call.
 *
 * Keyed on the caller's own Cognito sub, never on anything the request supplies, so one
 * student cannot read or write another's progress however the call is shaped.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export async function handler(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub) return json(401, { error: 'not signed in' });

  const method = event.requestContext.http.method;
  const pk = `USER#${sub}`;

  if (method === 'GET') {
    const course = event.queryStringParameters?.course;
    if (!course) return json(400, { error: 'course is required' });
    // Two reads rather than one: the place-marker deliberately sits outside the PROG#
    // prefix, so that a Query for solved exercises cannot pick it up and count it as one.
    const [r, place] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': `PROG#${course}#` },
      })),
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk: `LAST#${course}` } })),
    ]);
    return json(200, {
      solved: (r.Items || []).map(i => i.sk.split('#').slice(2).join('#')),
      last: place.Item?.exercise || null,
    });
  }

  if (method === 'PUT') {
    const { course, exercise, solved = true, last } = JSON.parse(event.body || '{}');
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
    await ddb.send(solved
      ? new PutCommand({ TableName: TABLE, Item: { pk, sk, course, exercise, at: new Date().toISOString() } })
      : new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
    return json(200, { ok: true });
  }

  return json(405, { error: `${method} not allowed` });
}
