/* User management.
 *
 *   GET    /api/admin/users            everyone in the pool, with their courses
 *   POST   /api/admin/users            { email, name?, courses?, admin?, resend? }
 *   PUT    /api/admin/users            { sub, name?, courses?, admin?, enabled? }
 *   DELETE /api/admin/users?sub=       delete the account and everything it owns
 *
 * COGNITO OWNS IDENTITY; THIS TABLE OWNS ENROLMENT. Name, email, sign-in status, whether
 * the account is enabled and whether it is in `admins` are all read back from the pool
 * rather than from a copy here - there is one writer for each fact and it is the pool.
 * What the table holds that Cognito cannot is which courses somebody is on.
 *
 * The name is nevertheless *echoed* onto the ENROL rows, as it always was, so that the
 * byCourse index answers "who is on course X" without a pool call. That is a cache, and
 * PUT rewrites it on a rename for the reason the original comment here gave: one fact in
 * two places diverges unless something keeps them together.
 *
 * There is deliberately no progress reporting here - see backlog.md.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand, AdminGetUserCommand, AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand, AdminEnableUserCommand, AdminDisableUserCommand,
  AdminAddUserToGroupCommand, AdminRemoveUserFromGroupCommand,
  ListUsersCommand, ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand, BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;
const POOL = process.env.USER_POOL_ID;
const GROUP = 'admins';

/* A listing is bounded so that a pool nobody expected to grow cannot time the function
 * out silently and hand back a half-list that reads as "those are all the users". Past
 * the cap the response says so and the screen says so. */
const PAGE = 60;              // Cognito's own maximum for ListUsers
const MAX_PAGES = 25;         // 1500 users
const FANOUT = 25;            // concurrent enrolment queries

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const isAdmin = claims => {
  const groups = claims?.['cognito:groups'];
  return Array.isArray(groups) ? groups.includes(GROUP) : String(groups ?? '').includes(GROUP);
};

const attr = (attrs, name) => attrs?.find(a => a.Name === name)?.Value;

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

/** Run `fn` over `items` at most `limit` at a time. Order of results follows `items`. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  }));
  return out;
}

/** The course ids somebody is enrolled on. */
async function enrolments(sub) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'ENROL#' },
    ProjectionExpression: 'sk',
  }));
  return (r.Items || []).map(i => i.sk.slice('ENROL#'.length));
}

/** Everyone in the pool. `truncated` when the cap above cut the listing short. */
async function listUsers() {
  const users = [];
  let token;
  let page = 0;
  do {
    const r = await cognito.send(new ListUsersCommand({
      UserPoolId: POOL, Limit: PAGE, PaginationToken: token,
    }));
    for (const u of r.Users || []) {
      users.push({
        sub: attr(u.Attributes, 'sub'),
        email: attr(u.Attributes, 'email') || u.Username,
        name: attr(u.Attributes, 'name') || '',
        // FORCE_CHANGE_PASSWORD means "invited, never signed in" - the single most useful
        // thing on this screen, and it is not derivable from anything in the table.
        status: u.UserStatus,
        enabled: u.Enabled !== false,
        created: u.UserCreateDate,
      });
    }
    token = r.PaginationToken;
  } while (token && ++page < MAX_PAGES);
  return { users, truncated: !!token };
}

/** The subs in the `admins` group. One call, not one per user. */
async function adminSubs() {
  const subs = new Set();
  let token;
  do {
    const r = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: POOL, GroupName: GROUP, Limit: PAGE, NextToken: token,
    }));
    for (const u of r.Users || []) subs.add(attr(u.Attributes, 'sub'));
    token = r.NextToken;
  } while (token);
  return subs;
}

/* THE SUB IS NOT THE USERNAME, and admin calls take the username.
 *
 * This pool signs in by email alias, so Cognito generated an opaque username of its own
 * and `sub` is a separate attribute. Aliases resolve on most Admin* calls, which is why
 * POST can pass an address straight through - but the screen identifies a person by sub,
 * because that is what keys their rows, and passing a sub where a username is wanted fails
 * with UserNotFound on a user who plainly exists.
 *
 * Resolving it here rather than trusting the caller to send a matching pair also means a
 * sub and an email address cannot be mismatched into modifying one account in the pool and
 * a different one in the table.
 */
async function lookup(sub) {
  const r = await cognito.send(new ListUsersCommand({
    UserPoolId: POOL, Filter: `sub = "${String(sub).replace(/"/g, '')}"`, Limit: 1,
  }));
  const found = r.Users?.[0];
  if (!found) throw new Error('no such user');
  return {
    username: found.Username,
    email: attr(found.Attributes, 'email') || found.Username,
    name: attr(found.Attributes, 'name') || '',
  };
}

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

/* Reissue an invitation whose temporary password has expired.
 *
 * The pool's TemporaryPasswordValidityDays is seven, and an expired temporary password
 * reads to the student as a broken site rather than as a stale email - so an admin has to
 * be able to send another one. RESEND on AdminCreateUser is the only way to do it: it
 * mints a fresh temporary password and re-sends the same template. Cognito refuses it for
 * a user who has already chosen a password, which is the right refusal - there is nothing
 * to reissue - so it is offered only where the status still says FORCE_CHANGE_PASSWORD. */
async function resendInvite(email, name) {
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: POOL,
    Username: email,
    MessageAction: 'RESEND',
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: displayName(name, email) },
    ],
    DesiredDeliveryMediums: ['EMAIL'],
  }));
}

/** Write the enrolment rows for `add`, drop those in `remove`. The name is the cache. */
async function setEnrolments(sub, email, name, add, remove) {
  await Promise.all([
    ...add.map(course => ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${sub}`, sk: `ENROL#${course}`, course, email, name },
    }))),
    ...remove.map(course => ddb.send(new DeleteCommand({
      TableName: TABLE, Key: { pk: `USER#${sub}`, sk: `ENROL#${course}` },
    }))),
  ]);
}

/** Everything the table holds about one person, gone. Returns how many rows that was. */
async function forget(sub) {
  const pk = `USER#${sub}`;
  let removed = 0;
  let start;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: start,
    }));
    const items = r.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      // BatchWrite can decline part of a batch under throttling; it reports what it did not
      // do rather than failing, so an unchecked call leaves rows behind and says it did not.
      let unprocessed = {
        [TABLE]: items.slice(i, i + 25).map(k => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })),
      };
      for (let attempt = 0; unprocessed[TABLE]?.length && attempt < 5; attempt++) {
        const w = await ddb.send(new BatchWriteCommand({ RequestItems: unprocessed }));
        unprocessed = w.UnprocessedItems || {};
      }
      if (unprocessed[TABLE]?.length) throw new Error('could not delete every row for that user');
    }
    removed += items.length;
    start = r.LastEvaluatedKey;
  } while (start);
  return removed;
}

const clean = email => String(email || '').trim().toLowerCase();
const courseList = v => (Array.isArray(v) ? v : []).map(c => String(c).trim()).filter(Boolean);

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!isAdmin(claims)) return json(403, { error: 'admins only' });

  const me = claims.sub;
  const method = event.requestContext.http.method;
  const q = event.queryStringParameters || {};

  try {
    if (method === 'GET') return await getUsers();
    if (method === 'POST') return await postUser(JSON.parse(event.body || '{}'));
    if (method === 'PUT') return await putUser(JSON.parse(event.body || '{}'), me);
    if (method === 'DELETE') return await deleteUser(q.sub, me);
  } catch (e) {
    console.error(e);
    return json(400, { error: e.message });
  }
  return json(405, { error: `${method} not allowed` });
}

async function getUsers() {
  const [{ users, truncated }, admins] = await Promise.all([listUsers(), adminSubs()]);
  /* One query per user rather than one per course, because only the first is authoritative:
   * the catalogue of courses lives in the content bucket and is assembled from every
   * card.json in it, so this function does not know - and should not have to learn - which
   * courses exist. A user enrolled on a course that has since been withdrawn is still
   * enrolled, and this is what shows it. */
  const courses = await mapLimit(users, FANOUT, u => enrolments(u.sub));
  return json(200, {
    users: users.map((u, i) => ({ ...u, admin: admins.has(u.sub), courses: courses[i] })),
    truncated,
  });
}

async function postUser({ email, name, courses, admin, resend }) {
  const address = clean(email);
  if (!address) return json(400, { error: 'email is required' });
  const wanted = courseList(courses);

  const { sub, invited } = await findOrInvite(address, name);

  // Only ever additive: POST is "put this person on these courses", and the CSV import
  // runs it once per row. Taking courses away is PUT's job, where the whole desired set
  // is stated rather than implied by what one row happened to mention.
  const already = new Set(await enrolments(sub));
  await setEnrolments(sub, address, displayName(name, address),
    wanted.filter(c => !already.has(c)), []);

  if (admin) await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: POOL, Username: address, GroupName: GROUP,
  }));

  let resent = false;
  if (resend && !invited) { await resendInvite(address, name); resent = true; }

  return json(200, { sub, invited, resent, enrolled: wanted });
}

async function putUser({ sub, name, courses, admin, enabled }, me) {
  if (!sub) return json(400, { error: 'sub is required' });

  /* THE ONE THING AN ADMIN MAY NOT DO IS UNMAKE THEMSELVES.
   *
   * Only the `admins` group can reach this function at all, so an admin who demotes or
   * disables their way out of it cannot undo it from the app - the fix is a console command
   * or `just grant-admin`, run by somebody who still has one. Blocking self-demotion also
   * means the group can never be emptied through this screen: demoting the last admin is
   * always somebody demoting themselves. */
  const self = sub === me;
  if (self && admin === false) return json(400, { error: 'you cannot remove your own admin rights' });
  if (self && enabled === false) return json(400, { error: 'you cannot disable your own account' });

  const { username, email, name: current } = await lookup(sub);
  const next = name === undefined ? current : displayName(name, email);

  if (next !== current) await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: POOL, Username: username, UserAttributes: [{ Name: 'name', Value: next }],
  }));

  if (enabled !== undefined) await cognito.send(enabled
    ? new AdminEnableUserCommand({ UserPoolId: POOL, Username: username })
    : new AdminDisableUserCommand({ UserPoolId: POOL, Username: username }));

  if (admin !== undefined) await cognito.send(admin
    ? new AdminAddUserToGroupCommand({ UserPoolId: POOL, Username: username, GroupName: GROUP })
    : new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL, Username: username, GroupName: GROUP }));

  const already = await enrolments(sub);
  if (courses !== undefined) {
    // The whole desired set, so a course left off it is a course taken away. The diff is
    // against what the table actually holds, not against what the screen was showing when
    // it was drawn.
    const wanted = new Set(courseList(courses));
    await setEnrolments(sub, email, next,
      [...wanted].filter(c => !already.includes(c)),
      already.filter(c => !wanted.has(c)));
  } else if (next !== current) {
    // A rename has to reach the cached copy on every enrolment row, or the byCourse index
    // keeps answering with the old name.
    await setEnrolments(sub, email, next, already, []);
  }

  return json(200, { ok: true, sub });
}

async function deleteUser(sub, me) {
  if (!sub) return json(400, { error: 'sub is required' });
  if (sub === me) return json(400, { error: 'you cannot delete your own account' });

  /* Cognito first, the rows second. The other order leaves an account that can still sign
   * in with no enrolments and no progress, which looks to the student like their work has
   * been lost; this order can at worst leave orphan rows keyed on a sub that no longer
   * signs in anywhere, which nothing reads and a re-run clears. */
  const who = await lookup(sub).catch(() => null);
  if (who) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL, Username: who.username }));
  const removed = await forget(sub);
  return json(200, { ok: true, removed });
}
