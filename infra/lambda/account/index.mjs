/* A person's own account.
 *
 *   GET    /api/account            everything this platform holds about the caller, summarised
 *   PUT    /api/account            { name }
 *   DELETE /api/account/progress?course=   start that course again from nothing
 *   GET    /api/account/export     a complete Article 15 response
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

/* WHAT WE HOLD AND WHY, in the words Article 15(1) asks for.
 *
 * ARTICLE 15 IS TWO THINGS, and the second is the one usually missed: a copy of the personal
 * data, AND supplementary information about the processing of it. A file with only the copy
 * looks generous and answers about a third of the article.
 *
 * ONE DEFINITION, RENDERED TWICE. It is returned by GET /api/account, where the account
 * screen draws it as its own privacy summary, and it is embedded verbatim in the export.
 * Written as prose in a component AND as JSON here, the two drift - and the drift is between
 * what we tell somebody and what we send them.
 *
 * It carries no personal data at all: every field is a fact about the platform. That is why
 * it can be a constant, and why sending it with the account summary costs a couple of
 * kilobytes rather than a query.
 *
 * The organisation's own details are COMMITTED CONTEXT, for the reason the alarm email and
 * the bootstrap admin are: passed as a flag they have to be remembered on every deploy, and
 * a privacy statement naming the wrong controller is worse than one that is late. The
 * fallbacks are deliberately obvious placeholders - a legal entity is not something this
 * file may invent.
 */
const ABOUT = {
  controller: {
    name: process.env.ORG_NAME || 'the course provider',
    contact: process.env.PRIVACY_CONTACT || '',
  },
  purposes: [
    'Giving you access to the courses you are enrolled on.',
    'Recording what you have solved, so that your progress and XP survive between sessions'
      + ' and across devices.',
    'Answering your requests for a hint, which sends your code to an AI service.',
    'Administering accounts - inviting you, enrolling you, and grouping you into a class.',
  ],
  categories: [
    'Identity: your name and the email address you sign in with.',
    'Enrolment: which courses you are on and which class you are in.',
    'Learning record: which exercises you have solved, when, what XP each earned, where you'
      + ' left off, and the code you wrote to solve them.',
    'Hint usage: how many hints you asked for, on which day and which course, and the size'
      + ' of each request.',
  ],
  recipients: [
    'Amazon Web Services, which hosts this platform. Your data is stored in the EU'
      + ' (eu-south-1, Milan).',
    'OpenAI, when you ask for a hint. THE CODE YOU WROTE IS SENT WITH THE REQUEST, because'
      + ' that is what the hint is about. OpenAI is in the United States, so this is a'
      + ' transfer outside the EU.',
  ],
  retention: [
    'Your account and your learning record are kept for as long as your account exists.',
    'The daily hint counter is deleted automatically after three days - it is a limit rather'
      + ' than history.',
    'Operational logs, which record that you signed in but not what you did, are kept for one'
      + ' month and then deleted automatically.',
  ],
  rights: [
    'Rectification: you can change your name on this page. Ask your tutor about anything else.',
    'Erasure: ask, and your account and everything above is deleted.',
    'Restriction and objection: ask.',
    'Portability: the download on this page is machine-readable JSON.',
  ],
  complaint: 'You can complain to the Information and Data Protection Commissioner in Malta'
    + ' - idpc.org.mt - if you think we have got this wrong.',
  source: 'From you, and from the tutor who created your account and enrolled you.',
  /* Said rather than omitted. Silence is what a reader assumes the worst about, and the
   * honest answer here is a good one: grading decides whether an exercise is right and
   * nothing follows from it. */
  automated: 'Nothing here makes an automated decision about you with legal or similarly'
    + ' significant effects. Your exercises are marked automatically, but that marking is'
    + ' formative - it tells you whether an answer is right, and nothing else follows from it.',
};

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
    // Only the export reads these, and it costs nothing to carry them: this is the same
    // ListUsers call either way.
    created: found.UserCreateDate,
    modified: found.UserLastModifiedDate,
    enabled: found.Enabled,
    status: found.UserStatus,
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
    /* Carried here so the screen can draw its privacy summary without a second call and
     * without writing the same prose again. It is a constant with no personal data in it -
     * see ABOUT. */
    about: ABOUT,
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

/* THE ACCESS REQUEST: everything we hold, and what we do with it.
 *
 * A COMPLETE ARTICLE 15 RESPONSE, not a convenience download - both halves. The copy is
 * below; the supplementary information is ABOUT, above, and both go in the file.
 *
 * GROUPED BY WHAT EACH ROW IS, not dumped as a list of rows. Article 12(1) asks for an
 * intelligible form, and `{"sk": "PROG#data-analyst-sql#1418943"}` is a partition key rather
 * than an answer. The grouping is the same one the prefixes already encode, so nothing here
 * decides what a row means - it only spells it.
 *
 * NO PROJECTION, unlike every other read in this file: the `code` on each PROG# row is the
 * bulky part of the partition and the part that makes this genuinely theirs. It is the only
 * route by which a student leaves here with the work they did.
 *
 * SPEND#hint# ROWS ARE INCLUDED. They are personal data by any reading - keyed on the
 * student, recording something they did - and leaving them out because of how they might
 * read would be a presentation decision overruling a legal one. The presentation problem is
 * solved as a presentation problem: they are called "hints you asked for" here and on the
 * screen, listed by day, and the token counts are present because they are in the row rather
 * than because they are the point.
 *
 * WHAT IS DELIBERATELY ABSENT, named so that it is a position rather than an omission:
 *
 *   HINTS#<course>   is not personal data - it counts hints per EXERCISE across everyone,
 *                    is not keyed on any person, and is not in this partition at all.
 *   CloudWatch logs  ARE personal data: a sub is a pseudonymous identifier. They are
 *                    disclosed in ABOUT.retention rather than copied in - they are
 *                    operational, they expire after a month, and a month of log lines would
 *                    be slower, larger and less legible than the sentence that explains them.
 *                    Somebody who specifically wants theirs asks a person.
 */
async function exportAll(sub, claims) {
  const who = await lookup(sub);
  const rows = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `USER#${sub}` },
  });

  const data = {
    enrolments: [], cohorts: [], progress: [], place: [],
    hintsAsked: [], hintCounters: [],
  };
  for (const r of rows) {
    const { pk, sk, ttl, ...rest } = r;
    if (sk.startsWith('ENROL#')) data.enrolments.push({ course: sk.slice(6), ...rest });
    else if (sk.startsWith('COHORT#')) data.cohorts.push({ cohort: sk.slice(7), ...rest });
    else if (sk.startsWith('PROG#')) {
      const [course, ...rest2] = sk.slice(5).split('#');
      data.progress.push({ course, exercise: rest2.join('#'), ...rest });
    } else if (sk.startsWith('LAST#')) data.place.push({ course: sk.slice(5), ...rest });
    else if (sk.startsWith('SPEND#hint#')) {
      const [day, ...c] = sk.slice(11).split('#');
      data.hintsAsked.push({ day, course: c.join('#'), ...rest });
    } else if (sk.startsWith('RATE#hint#')) {
      data.hintCounters.push({ day: sk.slice(10), ...rest });
    } else {
      /* A prefix nobody thought about when this was written still belongs to the person and
       * still has to come out. Named by its sort key rather than dropped, because silently
       * omitting a category is the one failure mode this whole function exists to avoid. */
      data.other = data.other || [];
      data.other.push({ key: sk, ...rest });
    }
  }

  return json(200, {
    generated: new Date().toISOString(),
    about: ABOUT,
    identity: {
      name: who.name,
      email: who.email,
      accountCreated: who.created,
      lastChanged: who.modified,
      enabled: who.enabled,
      status: who.status,
      // From the token: it is what the platform acts on, and it needs no extra permission.
      administrator: String(claims?.['cognito:groups'] ?? '').includes('admins'),
    },
    data,
  });
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
  const path = event.rawPath || '';
  const progress = /\/progress\/?$/.test(path);
  const exporting = /\/export\/?$/.test(path);
  try {
    if (method === 'DELETE' && progress)
      return await reset(sub, event.queryStringParameters?.course);
    if (method === 'GET' && exporting) return await exportAll(sub, claims);
    if (method === 'GET' && !progress && !exporting) return await get(sub, claims);
    if (method === 'PUT' && !progress && !exporting)
      return await put(sub, JSON.parse(event.body || '{}'));
    return json(405, { error: `${method} not allowed` });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message || 'that did not work' });
  }
}
