/* Student progress.
 *
 *   GET  /api/progress?course=<id>   -> { solved: [exerciseId] }
 *   PUT  /api/progress               { course, exercise, solved }
 *
 * Keyed on the caller's own Cognito sub, never on anything the request supplies, so one
 * student cannot read or write another's progress however the call is shaped.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

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
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': `PROG#${course}#` },
    }));
    return json(200, { solved: (r.Items || []).map(i => i.sk.split('#').slice(2).join('#')) });
  }

  if (method === 'PUT') {
    const { course, exercise, solved = true } = JSON.parse(event.body || '{}');
    if (!course || !exercise) return json(400, { error: 'course and exercise are required' });
    const sk = `PROG#${course}#${exercise}`;
    await ddb.send(solved
      ? new PutCommand({ TableName: TABLE, Item: { pk, sk, course, exercise, at: new Date().toISOString() } })
      : new DeleteCommand({ TableName: TABLE, Key: { pk, sk } }));
    return json(200, { ok: true });
  }

  return json(405, { error: `${method} not allowed` });
}
