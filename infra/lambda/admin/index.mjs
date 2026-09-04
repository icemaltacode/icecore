/* User management.
 *
 *   GET    /api/admin/users            everyone in the pool, with their courses and cohorts
 *   GET    /api/admin/users?sub=        one person, summarised across every course
 *   GET    /api/admin/users?sub=&course= one course of theirs, with what they wrote
 *   GET    /api/admin/users?course=     everyone on that course, and how far they are
 *   POST   /api/admin/users            { email, name?, cohorts?, admin?, resend? }
 *   PUT    /api/admin/users            { sub, name?, cohorts?, admin?, enabled? }
 *   DELETE /api/admin/users?sub=       delete the account and everything it owns
 *
 *   POST   /api/admin/cohorts          { title, courses? }    create one
 *   PUT    /api/admin/cohorts          { id, title?, courses?, archived? }
 *   DELETE /api/admin/cohorts?id=      the grouping, and none of the people
 *
 * THERE IS NO GET ON /cohorts. The catalogue rides back with the user listing, because the
 * screen that draws cohorts is the screen that draws people and asking twice for two halves
 * of one table is two round trips to show one thing. Member counts are then a tally of what
 * the listing already carried rather than a number this side has to compute.
 *
 * A COHORT IS A GROUP OF PEOPLE, AND IT IS WHAT CARRIES THE COURSES. Those are two claims
 * and only the first is old. A cohort is still not a property of a course - an intake may
 * take two, and the courses are a LIST on the cohort rather than a course id in its name.
 * What changed is the direction: a course reaches a person THROUGH the intake they are in.
 *
 * ENROLMENT IS DERIVED, NOT STORED, and that is the whole point of the change. There is no
 * `ENROL#` row any more and nothing writes one. A person's courses are the union of the
 * courses of the cohorts they are in, computed wherever it is needed from rows that were
 * already being read. A stored copy would be a copy that can disagree with the cohort - and
 * a cohort member missing the course being delivered to them was the exact bug this
 * removes, so re-introducing it as a cache would be undoing the work. See ADMIN.md.
 *
 * COGNITO OWNS IDENTITY; THIS TABLE OWNS MEMBERSHIP. Name, email, sign-in status, whether
 * the account is enabled and whether it is in `admins` are all read back from the pool
 * rather than from a copy here - there is one writer for each fact and it is the pool.
 * What the table holds that Cognito cannot is which intakes somebody is in.
 *
 * The name is nevertheless *echoed* onto the COHORT rows, as it always was, so that the
 * byCourse index answers "who is in cohort X" without a pool call. That is a cache, and
 * PUT rewrites it on a rename for the reason the original comment here gave: one fact in
 * two places diverges unless something keeps them together.
 *
 * There is deliberately no progress reporting here - see ADMIN.md.
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
  DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
/* The same writer the progress function uses, so a row written by an educator driving a
 * student is the same row in the same shape as one the student wrote themselves. The one
 * difference is the `by` this function passes and that one does not. */
import { writeProgress } from '../shared/progress-rows.mjs';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;
const POOL = process.env.USER_POOL_ID;
const GROUP = 'admins';

/* Every cohort lives in one partition, so listing them is one query rather than a scan.
 * Tens of rows on a table billed per request - the thing a single partition is bad at is
 * throughput, and this one is read once per admin screen. */
const COHORTS = 'COHORTS';

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

/* Which intakes somebody is in. One `begins_with`, one prefix.
 *
 * IT USED TO BE A RANGE ACROSS `COHORT#` AND `ENROL#` - one query for two prefixes, so that
 * cohorts cost nothing extra on the slowest screen in the app, at the price of a bound
 * (`ENROL$`) that any later sort-key beginning with D or E would fall inside and arrive in
 * the listing as an enrolment nobody wrote. That fragility bought a prefix that no longer
 * exists: enrolment is derived from the cohort now, so there is one prefix to read and a
 * plain `begins_with` reads it.
 */
async function memberships(sub) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'COHORT#' },
    ProjectionExpression: 'sk',
  }));
  return (r.Items || []).map(i => i.sk.slice('COHORT#'.length));
}

/**
 * THE ONE DEFINITION OF WHAT SOMEBODY'S COURSES ARE: the union of the courses of every
 * cohort they are in.
 *
 * A union rather than an intersection, and rather than a first-match: somebody in two
 * intakes is taking both their courses. Order follows the catalogue so two people with the
 * same courses list them the same way.
 *
 * ARCHIVING AN INTAKE DOES NOT TAKE ITS COURSES AWAY. Archiving is the ordinary end of an
 * intake - it keeps the statistics and clears the pickers - and a class that finished in
 * June still owns the material it was taught. Revoking on archive would make finishing a
 * course and losing it the same gesture.
 */
const coursesFrom = (cohortIds, byId) => {
  const seen = new Set();
  for (const id of cohortIds) for (const c of byId.get(id)?.courses || []) seen.add(c);
  return [...seen];
};

/** Every page of a query, because a cohort's roster is not something to cut short. */
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

/** Every cohort. One query, because they all share a partition. */
async function listCohorts() {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': COHORTS, ':sk': 'COHORT#' },
  });
  return items.map(i => {
    const id = i.sk.slice('COHORT#'.length);
    return {
      id, title: i.title || id, created: i.created, archived: !!i.archived,
      /* WHAT ITS MEMBERS ARE ON. An intake with none is a class that has been named and not
       * yet given anything to learn, which is a real and ordinary state - you name a class
       * before you decide what it is taking - so an empty list is not a broken cohort. */
      courses: Array.isArray(i.courses) ? i.courses : [],
    };
  });
}

/* The id is a SLUG OF THE TITLE, taken once and never moved again.
 *
 * A tutor types it into the cohort column of a CSV, so it has to be `sept-2026-evening`
 * rather than an opaque key. And because it never moves, renaming a cohort rewrites one row
 * instead of every membership row - the title drifting from its original slug is the
 * ordinary, harmless outcome of that, not a bug to chase. */
const slug = title => String(title).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Create one, disambiguating a slug that is already taken. `known` is a Map by id. */
async function createCohort(title, known, courses = []) {
  const base = slug(title) || 'cohort';
  let id = base;
  for (let n = 2; known.has(id); n++) id = `${base}-${n}`;
  const item = {
    pk: COHORTS, sk: `COHORT#${id}`, cohort: id,
    title: String(title).trim(), created: new Date().toISOString(), archived: false,
    courses: courseList(courses),
  };
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE, Item: item,
      // Two imports racing on the same new cohort name: the first one wins and the second
      // joins it, rather than overwriting a title somebody else just set.
      ConditionExpression: 'attribute_not_exists(sk)',
    }));
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
  }
  return { id, title: item.title, created: item.created, archived: false,
           courses: item.courses };
}

/* Names to cohort ids, creating what does not exist yet.
 *
 * Matched on the id first and then the title, case-insensitively, because the name arrives
 * from a CSV column a tutor typed and both are things they would reasonably write. THE
 * RESOLUTION IS AUTHORITATIVE HERE, not on the client: the import previews what it thinks
 * will be created, but two tutors importing two class lists at once can only agree if one
 * side decides. */
async function resolveCohorts(names, known) {
  const byId = new Map(known.map(c => [c.id, c]));
  const byTitle = new Map(known.map(c => [c.title.trim().toLowerCase(), c]));
  const ids = [];
  const made = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const hit = byId.get(name) || byTitle.get(name.toLowerCase());
    const cohort = hit || await createCohort(name, byId);
    if (!hit) {
      byId.set(cohort.id, cohort);
      byTitle.set(cohort.title.toLowerCase(), cohort);
      made.push(cohort);
    }
    if (!ids.includes(cohort.id)) ids.push(cohort.id);
  }
  return { ids, made };
}

/** Who is in a cohort. One query on `byCourse`, which inverts the key - see the stack. */
const cohortMembers = id => queryAll({
  TableName: TABLE, IndexName: 'byCourse',
  KeyConditionExpression: 'sk = :sk',
  ExpressionAttributeValues: { ':sk': `COHORT#${id}` },
  ProjectionExpression: 'pk, sk',
});

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

/* Write the rows in `add`, drop those in `remove`. The name is the cache.
 *
 * STILL WRITTEN AS A PREFIX rather than inlined into `setCohorts`, though `COHORT#` is now
 * the only one it is called with - `ENROL#` was the other and is gone. The shape is the
 * thing worth keeping: this is "a person belongs to a thing, and the thing's roster wants
 * their name on the row", and the next such relationship should be spelled this way rather
 * than invented again. The name is echoed so `byCourse` answers "who is in X" without a
 * call to the pool, and PUT rewrites it on a rename. */
async function setMembership(prefix, key, sub, email, name, add, remove) {
  await Promise.all([
    ...add.map(id => ddb.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${sub}`, sk: `${prefix}${id}`, [key]: id, email, name },
    }))),
    ...remove.map(id => ddb.send(new DeleteCommand({
      TableName: TABLE, Key: { pk: `USER#${sub}`, sk: `${prefix}${id}` },
    }))),
  ]);
}

const setCohorts = (sub, email, name, add, remove) =>
  setMembership('COHORT#', 'cohort', sub, email, name, add, remove);

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

/**
 * Progress written for somebody else, during remote control.
 *
 * THE ROW IS THEIRS AND THE ATTRIBUTION IS OURS. An exercise solved while an educator was
 * driving is the student's progress and the student's XP - it has to be, or being helped
 * would cost them the exercise - so what makes this auditable rather than indistinguishable
 * from their own work is the `by` field and nothing else.
 *
 * IT IS NOT ENOUGH TO BE AN ADMIN. This function may act on any sub, which is right for
 * managing accounts and far too wide for writing progress: it would make "an admin may
 * suspend anyone" and "an admin may silently award anyone XP" the same permission. So the
 * live session is read and the caller must be the one currently DRIVING that student. The
 * capability then lasts exactly as long as the control does, and the student can end it.
 *
 * It must not go through the account function, which acts on exactly the caller's sub and has
 * no sub parameter in the file - the day somebody adds a `?sub=` there for a good reason, the
 * boundary is gone. See ACCOUNT.md.
 */
async function putProgress(q, body, me) {
  const sub = q.sub;
  const cohort = q.cohort;
  if (!sub || !cohort) return json(400, { error: 'sub and cohort are required' });

  const held = await ddb.send(new GetCommand({
    TableName: TABLE, Key: { pk: COHORTS, sk: `LIVE#${cohort}` },
  }));
  const control = held.Item?.control;
  if (!control || control.by !== me || control.sub !== sub)
    return json(403, { error: 'You are not controlling that student.' });

  try {
    return json(200, await writeProgress(ddb, TABLE, sub, body, me));
  } catch (e) {
    return json(400, { error: e.message });
  }
}

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!isAdmin(claims)) return json(403, { error: 'admins only' });

  const me = claims.sub;
  const method = event.requestContext.http.method;
  const q = event.queryStringParameters || {};
  const path = event.requestContext.http.path || '';
  const cohorts = path.endsWith('/cohorts');

  try {
    if (path.endsWith('/progress')) {
      if (method === 'PUT') return await putProgress(q, JSON.parse(event.body || '{}'), me);
      return json(405, { error: `${method} not allowed` });
    }
    if (cohorts) {
      if (method === 'POST') return await postCohort(JSON.parse(event.body || '{}'));
      if (method === 'PUT') return await putCohort(JSON.parse(event.body || '{}'));
      if (method === 'DELETE') return await deleteCohort(q.id);
      return json(405, { error: `${method} not allowed` });
    }
    /* Three GETs on one path, told apart by what they carry rather than by a mode flag -
     * the same idiom the progress function uses, where one call names a course and the
     * other an instant. Everyone, one person, or one person on one course. */
    if (method === 'GET' && q.sub) return await getPerson(q.sub, q.course);
    if (method === 'GET' && q.course) return await getCourse(q.course);
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
  const [{ users, truncated }, admins, cohorts] = await Promise.all([
    listUsers(), adminSubs(), listCohorts(),
  ]);
  /* One query per user rather than one per course, because only the first is authoritative:
   * the catalogue of courses lives in the content bucket and is assembled from every
   * card.json in it, so this function does not know - and should not have to learn - which
   * courses exist. A user enrolled on a course that has since been withdrawn is still
   * enrolled, and this is what shows it.
   *
   * THE COURSES COST NOTHING AT ALL NOW. They used to be the other half of that one range
   * read; they are derived from the cohorts this response is already carrying, so the whole
   * of a person's courses is a lookup in a map of tens of rows rather than anything on the
   * wire. Which is the shape the change was worth having for. */
  const on = await mapLimit(users, FANOUT, u => memberships(u.sub));
  const byId = new Map(cohorts.map(c => [c.id, c]));
  return json(200, {
    users: users.map((u, i) => ({
      ...u, admin: admins.has(u.sub), cohorts: on[i], courses: coursesFrom(on[i], byId),
    })),
    cohorts,
    truncated,
  });
}

/* THERE IS NO `courses` HERE ANY MORE, and its absence is the change rather than an
 * omission. A person is put into an intake and takes what that intake takes; a course
 * granted to one person directly would be a second way onto a course, and the second way is
 * the one nothing keeps in step. Somebody who genuinely needs a course of their own gets a
 * cohort of their own - a cohort is a group of people, and one person is a group. */
async function postUser({ email, name, cohorts, admin, resend }) {
  const address = clean(email);
  if (!address) return json(400, { error: 'email is required' });
  const wantedCohorts = courseList(cohorts);

  const { sub, invited } = await findOrInvite(address, name);
  const label = displayName(name, address);

  /* An unknown cohort here is CREATED rather than refused, because naming an intake at the
   * moment you import it is the whole point of the field - and the import previews what it
   * is about to create, which is what makes that safe. */
  /* Listed unconditionally, because the answer needs it even when the row named no intake:
   * a person already in one is already on its courses, and a response that could only speak
   * about what this call changed would report them as being on nothing. */
  const known = await listCohorts();
  const { ids: cohortIds, made } = wantedCohorts.length
    ? await resolveCohorts(wantedCohorts, known)
    : { ids: [], made: [] };

  // Only ever additive: POST is "put this person in these intakes", and the CSV import runs
  // it once per row. Taking one away is PUT's job, where the whole desired set is stated
  // rather than implied by what one row happened to mention.
  const on = await memberships(sub);
  const inAlready = new Set(on);
  await setCohorts(sub, address, label, cohortIds.filter(c => !inAlready.has(c)), []);

  if (admin) await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: POOL, Username: address, GroupName: GROUP,
  }));

  let resent = false;
  if (resend && !invited) { await resendInvite(address, name); resent = true; }

  /* WHAT THEY ENDED UP ON, worked out rather than echoed back. The import lists it per row,
   * and the interesting case is a row that named no course at all and is now on three
   * because of the intake it joined - which is the whole feature and would be invisible if
   * this said only what the caller asked for. */
  const byId = new Map([...known, ...made].map(c => [c.id, c]));
  const all = [...new Set([...on, ...cohortIds])];
  return json(200, {
    sub, invited, resent, cohorts: all, created: made,
    enrolled: coursesFrom(all, byId),
  });
}

async function putUser({ sub, name, cohorts, admin, enabled }, me) {
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

  const on = await memberships(sub);

  let made = [];
  if (cohorts !== undefined) {
    /* The whole desired set, so an intake left off it is an intake somebody was taken out
     * of - stated rather than implied. Which now also means taken off its courses, and that
     * is the sharpest edge of this change: what used to remove a grouping now removes
     * access to the material. The screen says so. */
    const resolved = await resolveCohorts(courseList(cohorts), await listCohorts());
    made = resolved.made;
    const wanted = new Set(resolved.ids);
    await setCohorts(sub, email, next,
      [...wanted].filter(c => !on.includes(c)),
      on.filter(c => !wanted.has(c)));
  } else if (next !== current) {
    // A rename has to reach the cached copy on every membership row, or the byCourse index
    // keeps answering with the old name.
    await setCohorts(sub, email, next, on, []);
  }

  return json(200, { ok: true, sub, created: made });
}

/* ---- one person -------------------------------------------------------------------
 *
 * What a tutor asks when somebody says they are stuck, and the answer is already in the
 * table: `progress/index.mjs` writes the student's own source onto every PROG# row, keyed
 * by step, and until now nothing but that student ever read it back.
 *
 * TWO QUERIES RATHER THAN THE ONE RANGE the listing uses. `LAST#` and `PROG#` are adjacent
 * too, so the same trick would work - and it should not be used here. That trick buys one
 * query per person across the whole pool, on the slowest screen in the app; this is one
 * person, on demand, and the range's fragility is a real cost paid for nothing. Reach for
 * it where the fan-out is, not everywhere it would function.
 */

/** Every solve and every bookmark this person has, in two queries. */
async function history(sub) {
  const pk = `USER#${sub}`;
  const [progress, places] = await Promise.all([
    queryAll({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': 'PROG#' },
    }),
    queryAll({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': 'LAST#' },
      ProjectionExpression: '#c, exercise, #a',
      ExpressionAttributeNames: { '#c': 'course', '#a': 'at' },
    }),
  ]);
  return { progress, places };
}

/* The exercise id out of a sort key. `PROG#<course>#<exercise>`, and an exercise id may
 * itself contain a `#` - a slides row's id is made up on the client - so the course is
 * taken off the front rather than the id split off the back. */
const exerciseOf = (sk, course) => sk.slice(`PROG#${course}#`.length);
const courseOf = sk => sk.slice('PROG#'.length).split('#')[0];

/* How much of the student's own code to send back at once.
 *
 * A course's rows are the whole answer to "what did they write", and returning them one
 * exercise at a time would be a request per click on a screen made of clicks. But a row's
 * code is capped at 60KB and a course can hold hundreds, so the honest version has a
 * budget and says when it stopped rather than quietly returning half a picture. */
const CODE_BUDGET = 400_000;

async function getPerson(sub, course) {
  const [who, { progress, places }, on, cohorts] = await Promise.all([
    lookup(sub).catch(() => null),
    history(sub),
    // Only the summary needs it, but it is one query on a screen asked for by hand.
    memberships(sub),
    listCohorts(),
  ]);
  if (!who) return json(404, { error: 'no such user' });

  const place = Object.fromEntries(places.map(p => [p.course, { exercise: p.exercise, at: p.at }]));

  /* Summarised across every course they have touched - which is not the same as every
   * course they are ON. Somebody unenrolled keeps their progress, and a page that showed
   * only current enrolments would report a student who had done nothing. */
  if (!course) {
    const by = {};
    for (const row of progress) {
      const id = courseOf(row.sk);
      const c = by[id] || (by[id] = { course: id, solved: 0, xp: 0, first: null, last: null });
      c.solved++;
      c.xp += Number(row.xp) || 0;
      if (row.at && (!c.first || row.at < c.first)) c.first = row.at;
      if (row.at && (!c.last || row.at > c.last)) c.last = row.at;
    }
    for (const [id, p] of Object.entries(place))
      (by[id] || (by[id] = { course: id, solved: 0, xp: 0, first: null, last: null })).place = p;
    return json(200, {
      sub, email: who.email, name: who.name,
      courses: Object.values(by).sort((a, b) => (b.last || '').localeCompare(a.last || '')),
      /* What they are ENROLLED on, which is a different list from what they have touched
       * above - and the one a watched session has to draw its grid from. Seeing an admin's
       * whole catalogue while claiming to show a student's view would make the feature a
       * lie about the one thing it exists to show. */
      enrolled: coursesFrom(on, new Map(cohorts.map(c => [c.id, c]))),
      cohorts: on,
    });
  }

  const rows = progress.filter(r => courseOf(r.sk) === course);
  let spent = 0;
  let clipped = false;
  const solved = rows.map(r => {
    const entry = {
      exercise: exerciseOf(r.sk, course),
      xp: Number(r.xp) || 0,
      at: r.at || null,
    };
    if (r.code) {
      const size = JSON.stringify(r.code).length;
      if (spent + size <= CODE_BUDGET) { entry.code = r.code; spent += size; }
      else clipped = true;
    }
    return entry;
  });
  return json(200, {
    sub, email: who.email, name: who.name, course,
    solved: solved.sort((a, b) => (a.at || '').localeCompare(b.at || '')),
    xp: solved.reduce((n, e) => n + e.xp, 0),
    place: place[course] || null,
    // Said rather than silently dropped: a missing answer must not read as an exercise
    // solved without one.
    clipped,
  });
}

/* ---- one course ------------------------------------------------------------------
 *
 * How a class is doing, which is the one question this area could not ask before and the
 * only one a tutor cannot get by asking a student.
 *
 * THIS IS `byCourse`'s FIRST READER, and it uses several of its partitions at once. The
 * index inverts the key, so `COHORT#<id>` is an intake's roster in ONE query - with the name
 * and email cached on each row, which is what that cache was for - and `LAST#<course>` is
 * every student's bookmark AND their last-active time, also one query and no fan-out.
 *
 * THE ROSTER IS NOW A QUERY PER INTAKE ON THIS COURSE rather than one for the course, which
 * is the read this change cost. `ENROL#<course>` was a single partition holding exactly the
 * people on it; the same question is now "which intakes take this course, and who is in
 * them". A handful of queries instead of one, against a catalogue of tens of cohorts, and
 * they run together. Somebody in two intakes that both take it appears once: the union is
 * taken on the sub.
 *
 * What the index cannot answer is how much each of them has done: that is a count over each
 * student's own `PROG#<course>#` prefix. So it fans out per STUDENT, exactly as the user
 * listing does - tens of queries against the size of a class, rather than hundreds against
 * the size of a catalogue, which is what one query per exercise would be.
 *
 * The denominator is not here. The catalogue lives in the content bucket, and the client
 * already holds it - the same reason this function has never known which courses exist.
 */

/** One partition of `byCourse`, every page of it. */
const byCourse = (sk, projection) => queryAll({
  TableName: TABLE, IndexName: 'byCourse',
  KeyConditionExpression: 'sk = :sk',
  ExpressionAttributeValues: { ':sk': sk },
  ...(projection || {}),
});

const subOf = pk => pk.slice('USER#'.length);

async function getCourse(course) {
  const intakes = (await listCohorts()).filter(c => c.courses.includes(course));
  const [rosters, places, hints] = await Promise.all([
    Promise.all(intakes.map(c => byCourse(`COHORT#${c.id}`))),
    byCourse(`LAST#${course}`, {
      ProjectionExpression: 'pk, exercise, #a',
      ExpressionAttributeNames: { '#a': 'at' },
    }),
    /* Hint pressure per exercise, one query on its own partition. It is the only signal
     * here that is not a function of how far down the course somebody got: an exercise
     * everybody eventually solves but nobody solves unaided is hard, and solve counts alone
     * cannot say so. Aggregate and nobody's in particular - see the hint function. */
    queryAll({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `HINTS#${course}` },
    }),
  ]);

  /* ONE ROW PER PERSON. Somebody in two intakes that both take this course is one student
   * who would otherwise be counted, queried and drawn twice. Which intakes they are in is
   * not added here: the screen already has that from the user listing, and a second source
   * for it is a second thing to keep in step. */
  const seen = new Map();
  for (const rows of rosters) for (const r of rows) if (!seen.has(r.pk)) seen.set(r.pk, r);
  const roster = [...seen.values()];

  const place = Object.fromEntries(places.map(p => [subOf(p.pk), { exercise: p.exercise, at: p.at }]));

  const progress = await mapLimit(roster, FANOUT, r => queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': r.pk, ':sk': `PROG#${course}#` },
    ProjectionExpression: 'sk, xp, #a',
    ExpressionAttributeNames: { '#a': 'at' },
  }));

  /* WHICH exercises, not how many.
   *
   * This shipped as a count plus a server-side tally per exercise, and the tally was the
   * wrong shape: it was over the whole roster, so the moment the screen filtered to one
   * cohort it answered a different question from the rows beside it - silently, which is
   * the worst way for a number to be wrong. Sent as ids, every tally the client draws is a
   * tally of exactly the students it is showing.
   *
   * The rows were already fetched, so this costs no query and the count is `.length`. What
   * it does cost is payload: a class of thirty on a 376-exercise course is around 90KB,
   * which is the right trade at the scale this platform is built for - a training company's
   * classes - and would not be at ten thousand. */
  const students = roster.map((r, i) => {
    const rows = progress[i];
    let xp = 0;
    let last = null;
    const solved = [];
    for (const row of rows) {
      xp += Number(row.xp) || 0;
      if (row.at && (!last || row.at > last)) last = row.at;
      solved.push(exerciseOf(row.sk, course));
    }
    const sub = subOf(r.pk);
    return {
      sub, name: r.name || '', email: r.email || '',
      solved, xp, last,
      /* Where they are and how much they have done, together. A bookmark is not a
       * completion flag: somebody who finished last month is parked on the final exercise,
       * which reads identically to somebody stuck on it. Only the count tells them apart,
       * so the count travels beside the position and never instead of it. */
      place: place[sub] || null,
    };
  });

  return json(200, {
    course,
    students,
    hints: Object.fromEntries(hints.map(h => [h.sk, Number(h.n) || 0])),
  });
}

/* ---- cohorts -----------------------------------------------------------------------
 *
 * Three verbs and no listing: the catalogue rides back with the users, above. */

async function postCohort({ title, courses }) {
  const wanted = String(title || '').trim();
  if (!wanted) return json(400, { error: 'a cohort needs a name' });
  const known = await listCohorts();
  const hit = known.find(c => c.title.trim().toLowerCase() === wanted.toLowerCase());
  /* Naming one that exists is not an error - it is somebody arriving at the same intake
   * from the other screen. Hand back the one that is already there, and DO NOT quietly
   * apply the courses to it: this call did not know it was editing, and adding a course to
   * an existing intake puts material in front of everybody already in it. */
  if (hit) return json(200, { cohort: hit, created: false });
  const made = await createCohort(wanted, new Map(known.map(c => [c.id, c])), courses);
  return json(200, { cohort: made, created: true });
}

async function putCohort({ id, title, courses, archived }) {
  if (!id) return json(400, { error: 'id is required' });
  const sets = [];
  const names = {};
  const values = {};
  if (title !== undefined) {
    const wanted = String(title).trim();
    if (!wanted) return json(400, { error: 'a cohort needs a name' });
    sets.push('#title = :title'); names['#title'] = 'title'; values[':title'] = wanted;
  }
  /* WHAT THE INTAKE TAKES, and this is the write that puts a course in front of people or
   * takes it away from them. The whole desired set, like every other list in this file: a
   * course left off it is a course withdrawn from everyone in the class.
   *
   * It is not checked against a catalogue, because there is none to check against here -
   * courses live in the content bucket, assembled from every card.json in it, and this
   * function has never known which exist. The screen picks from the real list; a course id
   * typed into a CSV is checked by the importer against the catalogue the CLIENT holds. */
  if (courses !== undefined) {
    sets.push('#courses = :courses');
    names['#courses'] = 'courses';
    values[':courses'] = courseList(courses);
  }
  /* ARCHIVED, NOT DELETED, is how an intake finishes. A training company accumulates
   * them, and a picker holding forty dead classes is a picker nobody reads - but the
   * statistics of a finished intake are exactly the ones worth keeping. */
  if (archived !== undefined) {
    sets.push('#archived = :archived');
    names['#archived'] = 'archived';
    values[':archived'] = !!archived;
  }
  if (!sets.length) return json(400, { error: 'nothing to change' });

  /* The title is NOT echoed onto the membership rows, unlike the person's name. That cache
   * exists so `byCourse` can answer "who is in X" without a call to the pool; anything
   * reading a cohort has already read the cohort row, so a second copy here would be a
   * rename to propagate for no reader. */
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: COHORTS, sk: `COHORT#${id}` },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: 'attribute_exists(sk)',
  })).catch(e => {
    if (e.name === 'ConditionalCheckFailedException') throw new Error('no such cohort');
    throw e;
  });
  return json(200, { ok: true, id });
}

/* Deleting a cohort deletes NO ACCOUNT AND NO PROGRESS. Worth saying, because "delete"
 * beside a list of students reads as deleting students, and it never has been that.
 *
 * IT DOES NOW TAKE THE COURSES AWAY, and that is new. While enrolment was its own row this
 * removed a grouping and nothing else; a course reaches a person through their intake now,
 * so deleting the intake is deleting their way to the material. Their progress rows survive
 * it and reappear the moment they are put in an intake that takes it again - but the grid
 * goes empty in between, and the screen has to say so before the button is pressed.
 * Archiving is the gesture for an intake that has finished; this one is for one created by
 * mistake. */
/* Everything in the cohort's OWN partition, which today is its saved whiteboards - see
 * infra/lambda/boards. A board is the record of a lesson taught to this class, so it goes
 * when the class does: there is nobody left it belonged to, and it was never course
 * material. Archiving keeps them, which is the whole difference between an intake that
 * finished and one that is being erased. */
async function cohortOwned(id) {
  const rows = [];
  let start;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `COHORT#${id}` },
      ProjectionExpression: 'pk, sk',
      ExclusiveStartKey: start,
    }));
    rows.push(...(r.Items || []));
    start = r.LastEvaluatedKey;
  } while (start);
  return rows;
}

async function deleteCohort(id) {
  if (!id) return json(400, { error: 'id is required' });
  const members = await cohortMembers(id);
  /* Membership rows live in each PERSON's partition and the boards live in the cohort's own,
   * so this is two reads and one delete loop rather than one of each. */
  const owned = await cohortOwned(id);
  const rows = [...members, ...owned];
  for (let i = 0; i < rows.length; i += 25) {
    let unprocessed = {
      [TABLE]: rows.slice(i, i + 25)
        .map(m => ({ DeleteRequest: { Key: { pk: m.pk, sk: m.sk } } })),
    };
    for (let attempt = 0; unprocessed[TABLE]?.length && attempt < 5; attempt++) {
      const w = await ddb.send(new BatchWriteCommand({ RequestItems: unprocessed }));
      unprocessed = w.UnprocessedItems || {};
    }
    if (unprocessed[TABLE]?.length) throw new Error('could not remove every member of that cohort');
  }
  // The catalogue row last: a half-deleted cohort that still lists is one somebody can
  // press delete on again, where members left under a cohort nobody can see are not.
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: COHORTS, sk: `COHORT#${id}` } }));
  return json(200, { ok: true, removed: members.length, boards: owned.length });
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
