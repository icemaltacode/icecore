/* Onboarding, and nothing more.
 *
 *   GET    /api/admin/enrolments?course=<id>   who is on a course
 *   POST   /api/admin/enrolments               { email, course }  invite if new, then enrol
 *   DELETE /api/admin/enrolments?sub=&course=  unenrol
 *
 * There is deliberately no progress reporting here - see backlog.md. Inviting and enrolling
 * are one call because they are one act: nobody is created without a course to sit on.
 */
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;
const POOL = process.env.USER_POOL_ID;

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const isAdmin = claims => {
  const groups = claims?.['cognito:groups'];
  return Array.isArray(groups) ? groups.includes('admins') : String(groups ?? '').includes('admins');
};

/* What to write into the pool's `name` when the admin did not type one.
 *
 * Something has to be written: the pool declares `name` required, a schema cannot be altered
 * after the pool is created, and so every writer supplies one forever.
 *
 * The local part, NOT the whole address. `name || email` looks harmless and quietly disables
 * the fallback it was relying on: TopBar renders `name || email.split('@')[0]`, so a name
 * that is always set means the tidy fallback never runs and a student who was invited
 * without one reads their own full email address in the corner of every page. A default
 * that defeats the default underneath it. */
const displayName = (name, email) => (name || '').trim() || email.split('@')[0];

/** The Cognito sub for an email address, creating and inviting the user if they're new. */
async function findOrInvite(email, name) {
  try {
    const found = await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL, Username: email }));
    return { sub: attr(found.UserAttributes, 'sub'), invited: false };
  } catch (e) {
    if (e.name !== 'UserNotFoundException') throw e;
  }
  const created = await cognito.send(new AdminCreateUserCommand({
    UserPoolId: POOL,
    Username: email,
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: displayName(name, email) },
    ],
    DesiredDeliveryMediums: ['EMAIL'],   // sends the invitation with a temporary password
  }));
  return { sub: attr(created.User.Attributes, 'sub'), invited: true };
}

const attr = (attrs, name) => attrs?.find(a => a.Name === name)?.Value;

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!isAdmin(claims)) return json(403, { error: 'admins only' });

  const method = event.requestContext.http.method;
  const q = event.queryStringParameters || {};

  if (method === 'GET') {
    if (!q.course) return json(400, { error: 'course is required' });
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'byCourse',
      KeyConditionExpression: 'sk = :sk',
      ExpressionAttributeValues: { ':sk': `ENROL#${q.course}` },
    }));
    return json(200, {
      users: (r.Items || []).map(i => ({ sub: i.pk.slice('USER#'.length), email: i.email, name: i.name })),
    });
  }

  if (method === 'POST') {
    const { email, name, course } = JSON.parse(event.body || '{}');
    if (!email || !course) return json(400, { error: 'email and course are required' });
    let result;
    try {
      result = await findOrInvite(email.trim().toLowerCase(), name);
    } catch (e) {
      return json(400, { error: e.message });
    }
    // The same value that went into the pool, so the admin's list and the student's own
    // top bar cannot disagree about who they are. It used to store null here while writing
    // the email address into Cognito - one fact, two places, already diverging.
    const address = email.trim().toLowerCase();
    const item = { pk: `USER#${result.sub}`, email: address, name: displayName(name, address) };
    await Promise.all([
      ddb.send(new PutCommand({ TableName: TABLE, Item: { ...item, sk: `ENROL#${course}`, course } })),
      ddb.send(new PutCommand({ TableName: TABLE, Item: { ...item, sk: 'PROFILE' } })),
    ]);
    return json(200, { sub: result.sub, invited: result.invited });
  }

  if (method === 'DELETE') {
    if (!q.sub || !q.course) return json(400, { error: 'sub and course are required' });
    await ddb.send(new DeleteCommand({
      TableName: TABLE, Key: { pk: `USER#${q.sub}`, sk: `ENROL#${q.course}` },
    }));
    return json(200, { ok: true });
  }

  return json(405, { error: `${method} not allowed` });
}
