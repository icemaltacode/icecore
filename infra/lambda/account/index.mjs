/* A person's own account.
 *
 *   GET    /api/account            everything this platform holds about the caller, summarised
 *   PUT    /api/account            { name }
 *   DELETE /api/account/progress?course=   start that course again from nothing
 *
 * THE MIRROR OF THE ADMIN FUNCTION, AND ITS OPPOSITE. That one answers questions about
 * anybody and is reachable only by admins; this one answers questions about exactly one
 * person - whoever the token says - and is reachable by everybody. So there is no `sub`
 * parameter anywhere in it, not even an optional one: the only key it will ever build comes
 * from the claims, which is what makes "can this caller see this row" a question nobody has
 * to remember to ask.
 *
 * WHAT IT MAY CHANGE IS FACTS ABOUT A PERSON, NEVER FACTS ABOUT THEIR COURSE. Enrolment,
 * cohort, XP and what an exercise is worth are set by an admin or by the course repo. The
 * moment this function can adjust one of them it has become a second, worse admin panel with
 * the student holding it. See ACCOUNT.md.
 *
 * Cognito owns identity here exactly as it does in the admin function: the name comes back
 * from the pool rather than from the token, because the token was minted before the rename
 * and would show the old one until the student next signed in.
 */
import {
  CognitoIdentityProviderClient, ListUsersCommand, AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand, DeleteCommand, BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;
const POOL = process.env.USER_POOL_ID;
const COHORTS = 'COHORTS';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 40);

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

const attr = (attrs, name) => attrs?.find(a => a.Name === name)?.Value;

/* The same rule the admin function applies, for the same reason: the pool declares `name`
 * required and a schema cannot be altered after the pool is created, so every writer
 * supplies one forever. The local part rather than the whole address, or TopBar's
 * `name || email.split('@')[0]` fallback never runs and somebody reads their own email
 * address in the corner of every page.
 *
 * Written out here rather than shared with the admin function: two Lambdas bundled
 * separately, and a shared module between them would be a build-time coupling for eleven
 * characters. The comment is the coupling, and it names the other copy. */
const displayName = (name, email) => (name || '').trim() || email.split('@')[0];

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

/* THE SUB IS NOT THE USERNAME. The pool signs in by email alias, so Cognito generated an
 * opaque username of its own and `sub` is a separate attribute - passing one where the
 * other is wanted fails with UserNotFound on a user who plainly exists. */
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

/* Cohorts and courses in ONE query, exactly as the admin listing does it - see the long
 * comment on `belongings` there. `$` is one codepoint above `#`, so the range covers every
 * COHORT# and ENROL# row and nothing else. A prefix added later that begins with D or E
 * lands inside it. */
async function belongings(sub) {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':from': 'COHORT#', ':to': 'ENROL$' },
    ProjectionExpression: 'sk',
  });
  const cohorts = [];
  const courses = [];
  for (const i of items) {
    if (i.sk.startsWith('COHORT#')) cohorts.push(i.sk.slice('COHORT#'.length));
    else if (i.sk.startsWith('ENROL#')) courses.push(i.sk.slice('ENROL#'.length));
  }
  return { cohorts, courses };
}

/* Titles for the cohorts somebody is in.
 *
 * Reads the whole catalogue rather than fetching the two rows wanted, because it is one
 * partition, one query and tens of rows - and because it is how the admin function reads
 * cohorts, so there is one answer to "what is a cohort row" rather than two. Skipped
 * entirely when the student is in none, which is the common case. */
async function titles(ids) {
  if (!ids.length) return [];
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': COHORTS, ':sk': 'COHORT#' },
    ProjectionExpression: 'sk, title, archived',
  });
  const known = new Map(items.map(i => [i.sk.slice('COHORT#'.length), i]));
  /* An id with no row is still shown, under its own id. Membership and the cohort are two
   * rows and only one of them is deleted when a cohort is removed, so this is a real state
   * rather than a corrupt one - and a student seeing a class they are in is better than a
   * student seeing a shorter list with no explanation. */
  return ids.map(id => ({ id, title: known.get(id)?.title || id, archived: !!known.get(id)?.archived }));
}

/* What every course of theirs has earned, and how much of it is solved.
 *
 * ONE QUERY OVER THE PROG# PREFIX, tallied here rather than per course: a student is on a
 * handful of courses and this is a single partition read either way, so asking once and
 * splitting is strictly cheaper than asking per enrolment.
 *
 * The code each solve carries is deliberately NOT projected. It is the bulky part of the
 * partition - a whole course of submissions - and nothing on this screen shows it. The
 * export will want it and will ask for it then. */
async function progress(sub) {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'PROG#' },
    ProjectionExpression: 'sk, xp',
  });
  const byCourse = {};
  let total = 0;
  for (const i of items) {
    const course = i.sk.slice('PROG#'.length).split('#')[0];
    const xp = Number(i.xp) || 0;
    byCourse[course] = byCourse[course] || { solved: 0, xp: 0 };
    byCourse[course].solved += 1;
    byCourse[course].xp += xp;
    total += xp;
  }
  return { total, byCourse };
}

/* Hints taken today, against the limit.
 *
 * The RATE# row rather than the SPEND# ledger, because this is the number the hint function
 * actually enforces against - reading the ledger instead would give an answer that is
 * usually the same and occasionally, confusingly, not.
 *
 * THE DAY IS UTC HERE, because it is UTC in the hint function: this reports a limit somebody
 * else owns, and reporting it in the student's own timezone would show "3 of 40" beside a
 * refusal. That the limit rolls over at a time nobody in Malta would call midnight is a
 * property of the limit, and the fix belongs there rather than in the screen that quotes it.
 * (The XP counter is the opposite case and is deliberately local - see progress.js.)
 *
 * An absent row means none today: the TTL sweeps them after three days, so most students
 * have none most of the time. */
async function hints(sub) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await ddb.send(new GetCommand({
    TableName: TABLE, Key: { pk: `USER#${sub}`, sk: `RATE#hint#${day}` },
  }));
  const used = Number(r.Item?.n) || 0;
  return { used, limit: DAILY_LIMIT, left: Math.max(0, DAILY_LIMIT - used) };
}

async function get(sub, claims) {
  const who = await lookup(sub);
  const on = await belongings(sub);
  const [cohorts, earned, hint] = await Promise.all([
    titles(on.cohorts), progress(sub), hints(sub),
  ]);
  return json(200, {
    sub,
    name: who.name,
    email: who.email,
    /* From the token rather than from a second Cognito call: the app already trusts this
     * claim for what it draws, the API's authorizer verified it, and asking the pool would
     * be a ListUsersInGroup per account-screen open to tell somebody something they can
     * already see in their own top bar. */
    admin: String(claims?.['cognito:groups'] ?? '').includes('admins'),
    courses: on.courses,
    cohorts,
    xp: earned,
    hints: hint,
  });
}

/* Rename.
 *
 * THE CACHED COPIES ARE THE WHOLE JOB. `ENROL#` and `COHORT#` rows each carry the name so
 * that `byCourse` answers "who is in X" without a call to the pool, and a rename that
 * writes only the attribute leaves every admin list showing the old one. The client could
 * have written the attribute by itself - it is signed in and the pool allows it - and that
 * is exactly the version of this that would have been wrong.
 *
 * Rewritten rather than updated in place: the row is `{ pk, sk, course|cohort, email, name }`
 * and a Put of the same shape is one call with no expression, where an Update would need
 * one per row to change one attribute. Same number of round trips, less to get wrong.
 */
async function put(sub, body) {
  const wanted = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (wanted === undefined) return json(400, { error: 'name is required' });
  /* A cap, not validation. Cognito's own limit is 2048 and the top bar would wear anything
   * up to it; this is the length past which somebody is doing something other than being
   * called something. */
  if (wanted.length > 100) return json(400, { error: 'That name is too long.' });

  const { username, email, name: current } = await lookup(sub);
  const next = displayName(wanted, email);
  if (next === current) return json(200, { ok: true, name: next });

  await cognito.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: POOL, Username: username, UserAttributes: [{ Name: 'name', Value: next }],
  }));

  const on = await belongings(sub);
  await Promise.all([
    ...on.courses.map(course => ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${sub}`, sk: `ENROL#${course}`, course, email, name: next },
    }))),
    ...on.cohorts.map(cohort => ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${sub}`, sk: `COHORT#${cohort}`, cohort, email, name: next },
    }))),
  ]);

  return json(200, { ok: true, name: next });
}

/* Start one course again from nothing.
 *
 * PER COURSE, NEVER GLOBAL. "Start Data Analyst SQL again" is a real intention; "erase
 * everything I have ever done here" is not one anybody has, and offering it as one button
 * makes the smaller act feel like the larger one. There is deliberately no way to ask for
 * all of them at once.
 *
 * WHAT GOES, AND WHAT DELIBERATELY DOES NOT:
 *
 *   PROG#<course>#*   goes - every solve, its XP, and the code that solved it
 *   LAST#<course>     goes - the place marker
 *   ENROL#<course>    STAYS. Resetting progress is not leaving the course.
 *   COHORT#*          STAYS. A cohort is a group of people; this is not about who they are.
 *   SPEND#hint#*      STAYS. It is a financial record, and history is not the student's to
 *                     revise.
 *   HINTS#<course>    STAYS, and is not in this partition anyway. The per-exercise counter
 *                     is not about a student at all - it is the difficulty signal the
 *                     platform otherwise lacks entirely, which is why forget() spares it too.
 *
 * The bound is the sort key, not a filter: `begins_with(PROG#<course>#)` cannot reach
 * another course's rows even if the caller asks it to. Belt and braces against the one
 * mistake here that would be unrecoverable.
 */
async function reset(sub, course) {
  if (!course) return json(400, { error: 'course is required' });
  const pk = `USER#${sub}`;
  let removed = 0;
  let start;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': `PROG#${course}#` },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: start,
    }));
    const items = r.Items || [];
    for (let i = 0; i < items.length; i += 25) {
      /* BatchWrite declines part of a batch under throttling and REPORTS it rather than
       * failing, so an unchecked call leaves rows behind and says it did not. Same loop as
       * forget() in the admin function, for the same reason. */
      let unprocessed = {
        [TABLE]: items.slice(i, i + 25).map(k => ({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })),
      };
      for (let attempt = 0; unprocessed[TABLE]?.length && attempt < 5; attempt++) {
        const w = await ddb.send(new BatchWriteCommand({ RequestItems: unprocessed }));
        unprocessed = w.UnprocessedItems || {};
      }
      if (unprocessed[TABLE]?.length) throw new Error('could not clear every row - nothing else was touched');
    }
    removed += items.length;
    start = r.LastEvaluatedKey;
  } while (start);

  /* Last, and on its own. It sits outside the PROG# prefix on purpose - so that a query for
   * solved exercises cannot count it as one - which means the loop above never sees it. A
   * place marker left pointing into a course with no progress is harmless, where a solve
   * left behind is not, so it goes after rather than before. */
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk, sk: `LAST#${course}` } }));

  return json(200, { ok: true, course, removed });
}

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (!sub) return json(401, { error: 'not signed in' });

  const method = event.requestContext.http.method;
  /* Told apart by path as well as by method, the way the admin function tells its two
   * resources apart. `rawPath` rather than a route key, so a stage prefix cannot change the
   * answer. */
  const progress = /\/progress\/?$/.test(event.rawPath || '');
  try {
    if (method === 'DELETE' && progress)
      return await reset(sub, event.queryStringParameters?.course);
    if (method === 'GET' && !progress) return await get(sub, claims);
    if (method === 'PUT' && !progress) return await put(sub, JSON.parse(event.body || '{}'));
    return json(405, { error: `${method} not allowed` });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message || 'that did not work' });
  }
}
