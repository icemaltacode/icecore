/* The live channel: the one place two people's browsers can hear each other.
 *
 *   POST /api/live/ticket   { cohort }          -> { ticket, url, expires }
 *   ws   $connect           ?ticket=<id>        the ticket is the credential
 *   ws   $disconnect                            forget the connection
 *   ws   $default           { type, ... }       ping, active, marked, roster, history, say,
 *                                                 control, sharing, release, drive, buffer
 *
 * One function serving two HTTP routes and three WebSocket routes, told apart by the shape
 * of the event and then by path - the same way the admin function tells users from cohorts.
 * They belong together because they are one mechanism: the session is what there is to
 * connect to, the ticket is what a connection is opened with.
 *
 * ONLY ONE ADMIN MAY DELIVER TO A COHORT AT A TIME, and that is a conditional write rather
 * than a check. `attribute_not_exists(sk)` on the session row makes starting one atomic; a
 * check on the cohort screen would be a race, and the disabled Live button exists to
 * EXPLAIN the refusal rather than to prevent it.
 *
 * THE CLIENT NEVER SENDS ITS ID TOKEN TO THE SOCKET. A browser cannot set headers on a
 * WebSocket handshake - `new WebSocket(url)` takes a URL and nothing else - so a token would
 * have to travel in the query string, which is exactly where tokens end up in access logs
 * and referrers. Instead the client calls the HTTP API, which is already behind the JWT
 * authorizer, for a single-use ticket; `$connect` spends it. Everything the connection row
 * says about who is connected therefore comes from a row this function wrote, never from
 * anything the client asserted - the same property `lookup()` in the admin function relies
 * on when it resolves a sub rather than trusting one.
 *
 * That is also why there is no `WebSocketLambdaAuthorizer`. There is no JWT to verify at
 * `$connect`, so an authorizer would be a second Lambda in front of this one doing the same
 * conditional delete. `$connect` returning a non-2xx refuses the handshake, which is the
 * whole of the mechanism.
 *
 * TICKETS ARE SPENT WITH A CONDITIONAL DELETE, not read and then deleted: the delete is the
 * check. Two sockets opened with one ticket is a race that a read-then-write loses and this
 * cannot. The `ttl` on the row is housekeeping and NOT the expiry check - DynamoDB deletes
 * an expired item within 48 hours, not at the instant, so a minute-old ticket may well
 * still be sitting there. `expires` is checked here.
 *
 * FAN-OUT NEEDS NO NEW INDEX. A connection is `CONN#<id>` / `LIVECONN#<cohort>`, and the
 * `byCourse` GSI is (sk, pk) - so every connection in a session is one query on the index
 * for `sk = LIVECONN#<cohort>`. The sort key carries the cohort for exactly this reason;
 * with the cohort in an attribute instead, the same question would need an index of its own.
 *
 * `LIVE#` and `LIVECONN#`, and the prefix is not cosmetic: `belongings` in the admin
 * function reads cohorts and enrolments as ONE range, `sk BETWEEN 'COHORT#' AND 'ENROL$'`,
 * so any sort-key prefix beginning with D or E would arrive in the user listing as an
 * enrolment nobody wrote. L sorts after that range.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, DeleteCommand, UpdateCommand }
  from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand }
  from '@aws-sdk/client-apigatewaymanagementapi';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;
const GROUP = 'admins';

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/* A ticket is worth a minute. Long enough for a page that is also booting a course and a
 * database, short enough that one in a log is worth nothing by the time it is read. The
 * `ttl` is longer, because it exists only so an unspent ticket does not sit in the table
 * forever - it is housekeeping, not the expiry. */
const TICKET_SECONDS = 60;
/* A session nobody ended. Not a timeout on delivering - a lesson is an hour and this is a
 * day - but a floor under the lock, so a cohort cannot be held by a row from a laptop that
 * closed. The takeover in `end()` is the answer for the same day. */
const SESSION_HOURS = 24;
/* A connection row outlives any session anyone would run, and exists only to catch the
 * `$disconnect` that never arrived - a closed laptop lid, a dropped network. API Gateway
 * itself closes a socket after two hours, so nothing here should ever reach this. */
const CONNECTION_HOURS = 12;
const epoch = seconds => Math.floor(Date.now() / 1000) + seconds;

/* CHAT IS TRANSIENT AND LIVES ON THE SESSION ROW - the last `CHAT_KEEP`, so somebody who
 * joins ten minutes in can read what they walked in on, and gone the moment the session
 * row is deleted. See LIVE.md: messages are personal data, `forget()` in the account
 * function walks `USER#<sub>` and nothing else, and the Article 15 export has to be able to
 * produce everything the platform holds about somebody. Text on a COHORT partition is
 * reachable by neither, which is exactly the shape of thing that is discovered years later.
 * Making it transient removes the problem rather than handling it.
 *
 * The two numbers are a pair. A DynamoDB item is capped at 400KB and the session row also
 * carries the title, the course and the bookmark, so 200 x 600 bytes is the budget: 500
 * characters is a chat line rather than an essay, and the cap is what keeps the row inside
 * the limit however long a lesson runs. */
const CHAT_KEEP = 200;
const CHAT_CHARS = 500;
/* An editor buffer in flight. Matches STEP_LIMIT in shared/progress-rows.mjs, which is what
 * bounds the same text once it is written down - a buffer that could cross the channel and
 * then be refused by the row it was heading for would be a silent loss at exactly the moment
 * somebody was being helped. */
const EDITOR_LIMIT = 20000;

/* Same shape as the admin function's: a single group arrives as a string and several as an
 * array, and Cognito does not promise which. */
const isAdmin = claims => {
  const groups = claims?.['cognito:groups'];
  return Array.isArray(groups) ? groups.includes(GROUP) : String(groups ?? '').includes(GROUP);
};

/* Where the management API lives, and WHY THIS FILE IS DEPLOYED TWICE.
 *
 * The endpoint is `https://<socket apiId>.execute-api.../<stage>`. A socket event carries
 * that id, so the socket routes need nothing passed in - which is just as well, because
 * passing it to them is impossible: the function would depend on the stage, which depends
 * on the API, which depends on the function. A CloudFormation cycle.
 *
 * But an HTTP event does not carry it, and ending a session has to tell the room. So the
 * same module is deployed as a SECOND function serving only the HTTP routes, which nothing
 * in the socket API references and which can therefore be handed `WS_ENDPOINT` outright.
 * One file, because a message that two functions can both send must have one definition;
 * two Lambdas, because that is the shape of the dependency.
 *
 * A missing WS_ENDPOINT on a socket event is not a fallback, it is the normal path. */
const managementFor = event => new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_ENDPOINT
    || `https://${event.requestContext.apiId}.execute-api.`
       + `${process.env.AWS_REGION}.amazonaws.com/${event.requestContext.stage}`,
});

/**
 * Who is EXPECTED in a session, as opposed to who is connected.
 *
 * The membership rows, read through the inverted GSI - `COHORT#<id>` as a partition gives
 * every `USER#<sub>` in it, with the name already cached on the row. That cache is what
 * makes this one query rather than a pool call per person.
 *
 * It is sent to students as well as to the tutor, and that is the whole reason it is
 * computed here rather than taken from the admin listing: a student cannot read the user
 * table, and a participants panel that could only name the people currently connected would
 * show a class of twelve as a class of three.
 */
async function membersOf(cohort) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE, IndexName: 'byCourse',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeValues: { ':sk': `COHORT#${cohort}` },
  }));
  return (r.Items || [])
    .filter(i => String(i.pk).startsWith('USER#'))
    .map(i => ({ sub: i.pk.slice('USER#'.length), name: i.name || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const connectionsIn = async cohort => {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE, IndexName: 'byCourse',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeValues: { ':sk': `LIVECONN#${cohort}` },
  }));
  return r.Items || [];
};

/**
 * Send one payload to every connection in a cohort's session.
 *
 * A `GoneException` is ROUTINE and means the row is stale rather than that something failed:
 * a client that closed a laptop lid never sent `$disconnect`. Delete the row and carry on.
 * Every other failure is logged and swallowed - one unreachable client must not stop the
 * other eleven hearing what was said.
 */
async function emit(event, cohort, payload, { except, only, sub } = {}) {
  const api = managementFor(event);
  const body = Buffer.from(JSON.stringify(payload));
  /* `only` is a ROLE and `sub` is a PERSON, and both exist because two of the messages here
   * are not addressed to the room. How somebody answered is the tutor's business and
   * nobody else's; a `drive` is addressed to exactly the browser being driven, and to every
   * tab of it, because a student with two open is one person with two screens.
   *
   * Filtered on this side rather than trusting a client to ignore what it was sent - a
   * student with the developer tools open is still a student who can read the whole room's
   * answers, and in a classroom that is not a small thing. */
  const rows = (await connectionsIn(cohort))
    .filter(c => c.pk !== `CONN#${except}`)
    .filter(c => !only || c.role === only)
    .filter(c => !sub || c.sub === sub);
  const sent = await Promise.all(rows.map(async row => {
    const id = row.pk.slice('CONN#'.length);
    try {
      await api.send(new PostToConnectionCommand({ ConnectionId: id, Data: body }));
      return 1;
    } catch (e) {
      if (e.name === 'GoneException') {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: row.pk, sk: row.sk } }))
          .catch(() => {});
        return 0;
      }
      console.error('post failed', id, e.name, e.message);
      return 0;
    }
  }));
  /* How many HEARD it, not how many rows were tried. The difference is a stale row from a
   * socket that died without a `$disconnect`: counting those would report an audience that
   * is not there, and the count is the only thing telling the sender their words landed. */
  return sent.reduce((n, x) => n + x, 0);
}

const to = async (event, connectionId, payload) => {
  try {
    await managementFor(event).send(new PostToConnectionCommand({
      ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(payload)),
    }));
  } catch (e) {
    if (e.name !== 'GoneException') console.error('reply failed', e.name, e.message);
  }
};

/* ---- the HTTP half: the session ------------------------------------------ */

const COHORTS = 'COHORTS';
const sessionKey = cohort => ({ pk: COHORTS, sk: `LIVE#${cohort}` });
/* `LIVEMARK#`, NOT `LIVE#MARK#`, and the difference is load-bearing: the listing below asks
 * for `begins_with(sk, 'LIVE#')`, which a bookmark spelled the other way would answer as a
 * running session. A bookmark outlives the session that wrote it, so the two must not be
 * one query's worth of the same shape. */
const markKey = (cohort, course) => ({ pk: COHORTS, sk: `LIVEMARK#${cohort}#${course}` });
/* `LIVEPAST#`, and NOT the `LIVE#<cohort>#PAST#<endedAt>` the plan spelled - which is the
 * very mistake the comment above exists to prevent. `running()` asks for
 * `begins_with(sk, 'LIVE#')`, so a history row written that way would come back as a live
 * session for every cohort that had ever had one, and the Live button would refuse to start
 * a lesson on the grounds that last Tuesday's was still going. Same shape as the bookmark,
 * for the same reason, and it is worth noticing that the plan got it wrong in exactly the
 * place its own note warned about. */
const pastKey = (cohort, endedAt) => ({ pk: COHORTS, sk: `LIVEPAST#${cohort}#${endedAt}` });
/* A year. Long enough to be looking back at last term when planning this one, short enough
 * that a name on a cohort partition - which `forget()` cannot reach, because deleting a
 * person walks `USER#<sub>` and nothing scans for their name elsewhere - is not kept
 * indefinitely. Erasure here is a matter of time rather than of a scan nobody would
 * remember to write. */
const HISTORY_DAYS = 365;
/* How much of a lesson gets remembered. A lesson walks a few dozen rows; the cap is against
 * a tab left open for a day, not against a normal Tuesday. */
const COVERED_MAX = 200;

const shape = row => row && ({
  cohort: row.sk.slice('LIVE#'.length),
  /* The cohort's TITLE rides on the session row, cached at the moment it starts. A student
   * has no way to resolve one - the cohort catalogue comes back with the admin user listing
   * and nothing else - and the band naming the class is most of what tells them which
   * lesson this is. Cached rather than joined for the reason `ENROL#` rows cache a name. */
  title: row.title || '',
  course: row.course, by: row.by, name: row.name,
  at: row.at, sharing: !!row.sharing, position: row.position || null,
});

const sessionFor = async cohort => {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: sessionKey(cohort) }));
  return r.Item || null;
};

/** Every session running right now - one query, for the cohort screen's Live buttons. */
async function running() {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': COHORTS, ':sk': 'LIVE#' },
  }));
  return (r.Items || []).map(shape);
}

/**
 * Who was in the room, accumulated on the session row as people come and go.
 *
 * IT CANNOT BE DERIVED AT THE END. Connection rows are deleted on `$disconnect`, so by the
 * time a lesson finishes the only people left to count are the ones who stayed to the end -
 * which is the opposite of the question a tutor is asking.
 *
 * Written as a WHOLE VALUE per person rather than incremented, because the two facts that
 * matter - when they first appeared and how long they were here - are not both counters.
 * Concurrent writes are safe where it counts: `SET people.#sub` touches one path, so twelve
 * students arriving together do not contend. Two tabs of the SAME person can lose one write,
 * and for attendance that is a fair trade against a read-modify-write on every socket.
 *
 * Failures are swallowed. A student's presence is not worth refusing their connection over,
 * and the alternative is a lesson somebody cannot join because the register would not write.
 */
async function attended(cohort, sub, name, add = 0) {
  const held = await sessionFor(cohort);
  if (!held) return;                       // no session: nothing to be present at
  const now = new Date().toISOString();
  const was = held.people?.[sub];
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: sessionKey(cohort),
    UpdateExpression: 'SET #p.#sub = :who',
    ConditionExpression: 'attribute_exists(sk)',
    ExpressionAttributeNames: { '#p': 'people', '#sub': sub },
    ExpressionAttributeValues: {
      ':who': {
        name: name || was?.name || '',
        first: was?.first || now,
        last: now,
        ms: (was?.ms || 0) + Math.max(0, add),
      },
    },
  })).catch(e => console.error('attendance not recorded', e.name, e.message));
}

/** Where each of a cohort's courses was left, so the picker can say what it is resuming. */
async function marks(cohort) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': COHORTS, ':sk': `LIVEMARK#${cohort}#` },
  }));
  return Object.fromEntries((r.Items || []).map(i => [
    i.sk.slice(`LIVEMARK#${cohort}#`.length),
    { exercise: i.exercise, at: i.at, title: i.title || '' },
  ]));
}

/**
 * Keep one message on the session row, and trim the backlog back to CHAT_KEEP.
 *
 * THE CONDITION IS THE POINT: `attribute_exists` means a message sent into a session that
 * has just ended is fanned out to whoever is still listening and kept by nobody, rather
 * than resurrecting a deleted row as an orphan holding a class's chat with no session
 * attached to explain it or delete it.
 *
 * `said` is the tally the summary quotes. A count rather than the text, because the summary
 * outlives the session and the text deliberately does not.
 *
 * The trim is append-then-remove rather than a read-modify-write, which loses a race by
 * construction; this one can only lose backlog. Two messages arriving together both see the
 * list one over and both drop the front entry, so the window is 199 rather than 200 for a
 * moment. That is a fair trade for something whose whole purpose is to be forgotten.
 */
async function keep(cohort, said) {
  let after;
  try {
    const r = await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: sessionKey(cohort),
      UpdateExpression: 'SET #chat = list_append(if_not_exists(#chat, :none), :one) ADD #n :one_',
      ConditionExpression: 'attribute_exists(sk)',
      ExpressionAttributeNames: { '#chat': 'chat', '#n': 'said' },
      ExpressionAttributeValues: { ':none': [], ':one': [said], ':one_': 1 },
      ReturnValues: 'UPDATED_NEW',
    }));
    after = r.Attributes?.chat?.length || 0;
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException')
      console.error('chat could not be kept', e.name, e.message);
    return;
  }
  if (after <= CHAT_KEEP) return;
  await ddb.send(new UpdateCommand({
    TableName: TABLE, Key: sessionKey(cohort),
    UpdateExpression: 'REMOVE '
      + Array.from({ length: after - CHAT_KEEP }, (_, i) => `#chat[${i}]`).join(', '),
    ExpressionAttributeNames: { '#chat': 'chat' },
  })).catch(e => console.error('chat could not be trimmed', e.name, e.message));
}

/** Which cohorts somebody is in. One query on their own partition. */
async function cohortsOf(sub) {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'COHORT#' },
  }));
  return new Set((r.Items || []).map(i => i.sk.slice('COHORT#'.length)));
}

/**
 * What is running. Everything, for an admin; only your own classes, for everybody else.
 *
 * THE FILTER IS NEW AND IT IS NOT A DETAIL. This route has always been open to any signed-in
 * caller - a student's client has to know a session exists before it can offer to join one -
 * and while the only caller was the admin cohort screen that was harmless. The invitation is
 * what makes a student's client ask, and an unfiltered answer would hand every student the
 * id and title of every class in the school and the name of whoever is teaching it.
 *
 * Answered per USER rather than per session for the same reason the admin listing is: it is
 * one query against their own partition, and it cannot return a cohort they are not in
 * however many sessions are running.
 */
async function readSession(event, claims) {
  const cohort = event.queryStringParameters?.cohort;
  if (!cohort) {
    const all = await running();
    if (isAdmin(claims)) return json(200, { running: all });
    const mine = await cohortsOf(claims.sub);
    return json(200, { running: all.filter(s => mine.has(s.cohort)) });
  }
  /* And asking about ONE cohort obeys the same rule. Cohort ids are slugs a person typed -
   * `oct-2026-morning` is a guess anybody could make - so without this a student could learn
   * who is teaching what to every class in the school one id at a time, which is the listing
   * hole again through a different door.
   *
   * A refusal rather than an empty answer: the ticket route already turns them away, and
   * "there is no session" about a lesson that is running would send somebody looking for a
   * problem that does not exist. */
  if (!isAdmin(claims) && !(await cohortsOf(claims.sub)).has(cohort))
    return json(403, { error: 'You are not in that class.' });
  const [row, mark] = await Promise.all([sessionFor(cohort), marks(cohort)]);
  return json(200, { session: shape(row), marks: mark });
}

async function start(event, claims) {
  const { cohort, course } = JSON.parse(event.body || '{}');
  if (!cohort || !course) return json(400, { error: 'cohort and course are required' });

  const now = new Date().toISOString();
  const known = await ddb.send(new GetCommand({
    TableName: TABLE, Key: { pk: COHORTS, sk: `COHORT#${cohort}` },
  }));
  if (!known.Item) return json(404, { error: 'no such cohort' });

  const item = {
    ...sessionKey(cohort),
    title: known.Item.title || cohort,
    course, at: now,
    by: claims.sub,
    name: claims.name || String(claims.email || '').split('@')[0],
    sharing: false,
    /* THE TALLIES ARE SEEDED EMPTY RATHER THAN CREATED ON FIRST USE, and that is not tidiness:
     * `SET ex.#id = ...` and `ADD ex.#id.#tried :one` are both writes to a document PATH, and
     * a path whose parent is absent fails the whole update. Seeding here means the common
     * case is one write with no branch in it. */
    people: {},      // sub -> who was here, and for how long
    ex: {},          // exercise -> what it did to the class
    covered: [],     // where the educator took them, in order
    ttl: epoch(SESSION_HOURS * 3600),
  };
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE, Item: item,
      ConditionExpression: 'attribute_not_exists(sk)',
    }));
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
    // Say WHO, because the only useful thing about this refusal is who to ask.
    const held = await sessionFor(cohort);
    return json(409, {
      error: `${held?.name || 'Somebody'} is already delivering to this cohort.`,
      session: shape(held),
    });
  }
  return json(200, { session: shape(item), marks: await marks(cohort) });
}

async function end(event, claims) {
  const cohort = event.queryStringParameters?.cohort;
  if (!cohort) return json(400, { error: 'cohort is required' });
  const held = await sessionFor(cohort);
  if (!held) return json(200, { ok: true, ended: false });

  /* Yours to end - or ABANDONED, which is the case that matters. A session belongs to the
   * admin who started it, so one admin cannot close another's lesson from the cohort list.
   * But a tutor whose laptop died holds the lock until the ttl a day later, and a class
   * cannot wait a day: a session with nobody connected to it is nobody's lesson, and any
   * admin may clear it. Presence is derived from connections here exactly as it is
   * everywhere else - there is no stored "still going" flag to go stale. */
  if (held.by !== claims.sub) {
    const live = await connectionsIn(cohort);
    if (live.length) return json(409, {
      error: `${held.name || 'Somebody else'} is delivering to this cohort, with `
        + `${live.length} connected. Only they can end it.`,
      session: shape(held),
    });
  }

  /* THE BOOKMARK, and it is written HERE rather than continuously: a session that has not
   * ended has not left off anywhere. The position comes from the ending client, falling
   * back to whatever the session row last recorded - which is nothing today and is what
   * step 4's position broadcast will fill in.
   *
   * IT IS THE COHORT'S MARK AND NOBODY'S OWN. Every student already has a `LAST#` row per
   * course, written on every move, and that is what the player resumes them to. The two
   * look identical on screen and answer different questions: "where did I get to" and
   * "where did we get to as a class". Writing one to mean the other would move a student
   * who ran ahead back to where the class stopped, or open a lesson at whatever the tutor
   * happened to be reading on the train.
   *
   * Missing means missing: a session ended without a position leaves the previous mark
   * alone rather than overwriting it with nothing. A tutor whose browser closed mid-lesson
   * should lose the mark's advance, not the mark. */
  const where = event.queryStringParameters?.exercise || held.position?.exercise || '';
  if (where) {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...markKey(cohort, held.course),
        cohort, course: held.course,
        exercise: String(where).slice(0, 200),
        title: String(event.queryStringParameters?.title || held.position?.title || '').slice(0, 200),
        at: new Date().toISOString(),
        by: claims.sub,
      },
    }));
  }

  /* THE HISTORY ROW IS WRITTEN BEFORE THE SESSION ROW IS DELETED, in that order and not the
   * other, because the tallies live on the row being deleted. The reverse order loses an hour
   * of a class's work to a Lambda that timed out between two writes. */
  const endedAt = new Date().toISOString();
  const summary = digest(held, endedAt, where ? { exercise: String(where), title:
    String(event.queryStringParameters?.title || held.position?.title || '') } : null);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...pastKey(cohort, endedAt),
      cohort, course: held.course,
      by: held.by, name: held.name,
      title: held.title || cohort,
      at: held.at, endedAt,
      ...summary,
      ttl: epoch(HISTORY_DAYS * 86400),
    },
  })).catch(e => console.error('history not written', e.name, e.message));

  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: sessionKey(cohort) }));
  await emit(event, cohort, { type: 'ended', by: claims.sub });
  /* THE SUMMARY COMES BACK WITH THE ENDING, rather than being fetched afterwards. The screen
   * that shows it is the one that pressed the button; a second round trip to read a row this
   * function has just written would be a spinner over an answer it already had. */
  return json(200, { ok: true, ended: true, marked: !!where, summary: { ...summary,
    cohort, course: held.course, title: held.title || cohort, at: held.at, endedAt } });
}

/**
 * An hour of a class, reduced to the four things a tutor asks afterwards.
 *
 * Where the next session opens, what was covered, who was here, and what to fix. FOUR AND NOT
 * MORE: everything else this row could carry is a question somebody might ask, and a summary
 * that answers everything is one nobody reads.
 *
 * NAMES ARE FROZEN HERE. `ENROL#` and `COHORT#` rows cache a name and PUT rewrites it on a
 * rename, because they answer "who is on this course now". This answers "who was in the room
 * on the 3rd of September", which a later rename does not change - it is a snapshot, and
 * snapshots that get edited are not records.
 *
 * `worst` is ordered by what went WRONG rather than by attempts: an exercise everybody tried
 * once and got is not the one to look at, and one that six people could not run is. The
 * question `CoursePage`'s stall view already asks, narrowed to an hour.
 */
function digest(held, endedAt, mark) {
  const people = Object.entries(held.people || {})
    .map(([sub, p]) => ({
      sub, name: p.name || '',
      first: p.first, last: p.last,
      minutes: Math.round((Number(p.ms) || 0) / 60000),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ex = Object.entries(held.ex || {}).map(([id, e]) => ({
    exercise: id, title: e.title || '',
    tried: Number(e.tried) || 0, right: Number(e.right) || 0,
    wrong: Number(e.wrong) || 0, err: Number(e.err) || 0,
  }));

  return {
    /* Where the next one opens. First on the row as it is first on the screen: it is the only
     * part of the summary that changes anything. */
    mark,
    minutes: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(held.at)) / 60000)),
    covered: (held.covered || []).map(c => ({ exercise: c.exercise, title: c.title })),
    people,
    said: Number(held.said) || 0,
    worst: ex.filter(e => e.wrong + e.err > 0)
      .sort((a, b) => (b.wrong + b.err) - (a.wrong + a.err))
      .slice(0, 5),
  };
}

/* ---- the HTTP half: minting a ticket ------------------------------------- */

async function mint(event, claims) {
  const sub = claims.sub;
  const { cohort } = JSON.parse(event.body || '{}');
  if (!cohort) return json(400, { error: 'cohort is required' });

  /* An admin may deliver to any cohort; everybody else has to be IN the one they are
   * asking to join. Checked here rather than at `$connect` because this is the call that
   * has the claims - by the time the socket opens, the only identity in play is the one
   * this row carries. */
  const admin = isAdmin(claims);
  if (!admin) {
    const member = await ddb.send(new GetCommand({
      TableName: TABLE, Key: { pk: `USER#${sub}`, sk: `COHORT#${cohort}` },
    }));
    if (!member.Item) return json(403, { error: 'not in that cohort' });
  }

  const ticket = randomUUID();
  const expires = new Date(Date.now() + TICKET_SECONDS * 1000).toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `LIVE#TICKET#${ticket}`, sk: 'TICKET',
      sub, cohort, expires,
      role: admin ? 'tutor' : 'student',
      /* The name is cached onto the ticket and rides to the connection row, so the
       * participants panel is one query with names already on it - the same trade `ENROL#`
       * and `COHORT#` rows already make, and for the same reason. */
      name: claims.name || String(claims.email || '').split('@')[0],
      email: claims.email || '',
      ttl: epoch(TICKET_SECONDS * 5),
    },
  }));
  return json(200, { ticket, expires });
}

/* ---- the socket half ------------------------------------------------------ */

async function connect(event) {
  const id = event.requestContext.connectionId;
  const ticket = event.queryStringParameters?.ticket;
  if (!ticket) return { statusCode: 401, body: 'a ticket is required' };

  /* THE DELETE IS THE CHECK. `attribute_exists` makes spending a ticket atomic, so two
   * sockets opened with one ticket cannot both succeed - the second gets the conditional
   * failure and is refused. */
  let spent;
  try {
    const r = await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `LIVE#TICKET#${ticket}`, sk: 'TICKET' },
      ConditionExpression: 'attribute_exists(pk)',
      ReturnValues: 'ALL_OLD',
    }));
    spent = r.Attributes;
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException')
      return { statusCode: 401, body: 'that ticket has been used' };
    throw e;
  }
  // Not the ttl: DynamoDB deletes an expired item within 48 hours, not at the instant.
  if (!spent || spent.expires < new Date().toISOString())
    return { statusCode: 401, body: 'that ticket has expired' };

  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `CONN#${id}`, sk: `LIVECONN#${spent.cohort}`,
      sub: spent.sub, name: spent.name, email: spent.email, role: spent.role,
      cohort: spent.cohort,
      at: now,
      seen: now,
      ttl: epoch(CONNECTION_HOURS * 3600),
    },
  }));

  /* The room is told, and the NEWCOMER IS NOT - not from here.
   *
   * A connection does not exist until this handler returns 2xx, so posting to it from
   * inside `$connect` fails with `GoneException`. Which this file swallows, because a
   * GoneException is the ordinary way a stale row announces itself - so the roster would
   * simply never arrive, silently, and the panel would sit empty until somebody moved.
   *
   * So the newcomer asks, on open, and the `roster` message type exists for that. It has to
   * exist anyway: a client that reconnects after a tunnel or API Gateway's two-hour cap has
   * a roster from before it went away and every join and leave in between happened to
   * somebody who was not listening.
   *
   * AFTER the row is written, so a client that asks the instant it hears this finds itself
   * in the answer. */
  await emit(event, spent.cohort, {
    type: 'joined',
    who: { sub: spent.sub, name: spent.name, role: spent.role, seen: now, position: null },
  }, { except: id });
  // The register, and only for the people the summary is about.
  if (spent.role !== 'tutor') await attended(spent.cohort, spent.sub, spent.name);
  return { statusCode: 200, body: 'connected' };
}

/* The connection id is all `$disconnect` carries, so the row is found before it is deleted.
 * One extra read on a path that runs once per socket, which buys the sort key carrying the
 * cohort - and that is what makes fan-out a single query on an index that already exists. */
const rowFor = async connectionId => {
  const r = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': `CONN#${connectionId}` },
    Limit: 1,
  }));
  return r.Items?.[0] || null;
};

async function disconnect(event) {
  const row = await rowFor(event.requestContext.connectionId);
  if (!row) return { statusCode: 200, body: 'gone' };
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: row.pk, sk: row.sk } }));
  /* The row is deleted FIRST, so `left` cannot be heard by a client that then re-reads a
   * roster still containing the person who just left. The order matters more than it looks:
   * a second tab of the same person is a second row, so the client counts connections per
   * person rather than treating one `left` as somebody going offline. */
  await emit(event, row.cohort, { type: 'left', sub: row.sub });
  /* How long they were actually here, added on the way out - which is the only moment it is
   * known. A socket that died without a `$disconnect` contributes nothing, and that is the
   * honest answer rather than a guess at when it stopped. */
  if (row.role !== 'tutor') {
    await attended(row.cohort, row.sub, row.name,
                   Math.max(0, Date.now() - Date.parse(row.at || 0)));
  }
  await orphaned(event, row);
  return { statusCode: 200, body: 'gone' };
}

/**
 * Control that has lost one of its two ends.
 *
 * A CLOSED TAB MUST NOT LEAVE SOMEBODY LOCKED. An admin whose browser died holds a student
 * until the session's `ttl` a day later, and the student sees a band naming somebody who is
 * no longer there and cannot end it from their side because there is nothing to tell. The
 * student's own disconnection is the mirror: driving a browser that is gone is driving
 * nothing.
 *
 * COUNTED, NOT ASSUMED. Closing one of two tabs is not leaving, and releasing on the first
 * `$disconnect` would take control away from an admin still sitting in front of it. The
 * `left` above has the same shape and the client counts it the same way.
 *
 * Conditional on the pair still being the one that lost its browser, so a release racing a
 * fresh `control` cannot undo it.
 */
async function orphaned(event, row) {
  const held = await sessionFor(row.cohort);
  const c = held?.control;
  if (!c || (c.by !== row.sub && c.sub !== row.sub)) return;
  const still = (await connectionsIn(row.cohort)).some(x => x.sub === row.sub);
  if (still) return;
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: sessionKey(row.cohort),
      UpdateExpression: 'REMOVE #c',
      ConditionExpression: '#c.#by = :by AND #c.#sub = :sub',
      ExpressionAttributeNames: { '#c': 'control', '#by': 'by', '#sub': 'sub' },
      ExpressionAttributeValues: { ':by': c.by, ':sub': c.sub },
    }));
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
    return;   // somebody took it in the meantime, and theirs is the live one
  }
  await emit(event, row.cohort, { type: 'controlling', control: null });
}

async function message(event) {
  const id = event.requestContext.connectionId;
  const row = await rowFor(id);
  // A socket whose row has gone is a socket this function no longer knows anything about.
  if (!row) return { statusCode: 401, body: 'unknown connection' };

  let msg;
  try { msg = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'not JSON' }; }

  const now = new Date().toISOString();

  switch (msg.type) {
    /* The keep-alive, and IT DOES NOT COUNT AS ACTIVITY. That is the whole distinction this
     * feature rests on: the socket has to be kept open or API Gateway closes it after ten
     * minutes, and if keeping it open also counted as the person being present, nobody
     * would ever go idle - a tab left open on a train would show as attentive for the whole
     * lesson. `ping` keeps the connection; `active` keeps the person. */
    case 'ping':
      await to(event, id, { type: 'pong', at: now });
      return { statusCode: 200, body: 'ok' };

    /* A person did something: moved, typed, clicked. This is what `seen` means, and it
     * carries where they are as well as that they are there, because the two facts arrive
     * together and a second message for the position would be a second thing to keep in
     * step with this one. */
    case 'active': {
      const at = msg.at == null ? null : String(msg.at).slice(0, 200);
      /* `slide` rides along because a slides step is a RANGE, not a place: a follower sent
       * to the same step lands at the top of it while the tutor is nine slides in, which
       * looks exactly like following being broken. Null for every other kind of row. */
      const slide = Number(msg.slide) || null;
      const position = at === null ? null
        : { exercise: at, title: String(msg.title || '').slice(0, 200), slide };
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: row.pk, sk: row.sk },
        UpdateExpression: 'SET seen = :now, #p = :p',
        ExpressionAttributeNames: { '#p': 'position' },
        ExpressionAttributeValues: { ':now': now, ':p': position },
      })).catch(() => {});
      /* Only when they have actually MOVED. A student answering a multiple-choice question
       * is active every few seconds and in the same place all the while; broadcasting that
       * would be a dozen posts per person per minute telling eleven other clients nothing
       * they did not know. */
      if (position?.exercise !== row.position?.exercise
          || position?.slide !== row.position?.slide) {
        await emit(event, row.cohort, {
          type: 'moved', sub: row.sub, position, at: now,
        }, { except: id });
      }
      /* WHAT THE LESSON COVERED IS WHERE THE EDUCATOR WENT, not where anybody went. A student
       * reading ahead has not covered anything with the class, and counting them would make
       * the summary a record of the most restless person in the room.
       *
       * The same write seeds this exercise's tally, so that the `ADD` a student's mark does
       * later has a document path to land on. That is the whole reason these two live in one
       * statement rather than in the two places they belong to. */
      if (row.role === 'tutor' && position?.exercise
          && position.exercise !== row.position?.exercise) {
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: sessionKey(row.cohort),
          UpdateExpression:
            'SET #cov = list_append(if_not_exists(#cov, :none), :one), '
            + '#ex.#id = if_not_exists(#ex.#id, :seed)',
          ConditionExpression: 'attribute_exists(sk) AND size(#cov) < :cap',
          ExpressionAttributeNames: { '#cov': 'covered', '#ex': 'ex', '#id': position.exercise },
          ExpressionAttributeValues: {
            ':none': [],
            ':one': [{ exercise: position.exercise, title: position.title, at: now }],
            ':seed': { title: position.title, tried: 0, right: 0, wrong: 0, err: 0 },
            ':cap': COVERED_MAX,
          },
        })).catch(e => {
          // A full list is not a failure worth logging every time; anything else is.
          if (e.name !== 'ConditionalCheckFailedException')
            console.error('covered not recorded', e.name, e.message);
        });
      }
      return { statusCode: 200, body: 'ok' };
    }

    /* SOMEBODY PRESSED CHECK. Every press, not only the ones that pass: "answered wrongly"
     * and "has not answered" are the two states a tutor most needs to tell apart, and they
     * are indistinguishable from a `PROG#` row, which is only ever written on a success.
     *
     * IT GOES TO THE TUTORS AND TO NOBODY ELSE. A class watching each other's answers
     * arrive during a multiple-choice question is a different activity from the one being
     * run, and the confident student answering first would decide it for everybody.
     *
     * ONE MARK PER CONNECTION, kept on the row exactly as `position` is - the latest, not a
     * history. That is what a tutor arriving late or reloading gets back with the roster;
     * the fuller picture accumulates on their client from the messages themselves. A map of
     * every exercise would grow all lesson on a row that dies when the socket does, which is
     * the worst of both. */
    case 'marked': {
      const at = msg.at == null ? null : String(msg.at).slice(0, 200);
      if (at === null) return { statusCode: 200, body: 'nothing to mark' };
      const mark = {
        exercise: at,
        // Which step of a multi-step exercise, and which option where there was one.
        step: Number.isFinite(Number(msg.step)) ? Number(msg.step) : null,
        /* A NUMBER, and it has to stay one. Every choice in the player is an option INDEX,
         * so the length cap this used to have was bounding the wrong kind of thing - and
         * `String(2)` reaching the client as `"2"` is the exact trap CLAUDE.md documents
         * for exercise ids. It happens to survive a tally, where an object key is a string
         * either way, and would not survive the next reader. Null first, because
         * `Number(null)` is 0 and 0 is a real option. */
        choice: msg.choice == null ? null
          : Number.isFinite(Number(msg.choice)) ? Number(msg.choice) : null,
        pass: !!msg.pass,
        /* An ERROR is not a wrong answer, and `grade.js` already keeps them apart for the
         * Ask AI nudge. A tutor seeing six people stuck wants to know which six are wrong
         * and which six cannot get the query to run at all. */
        error: !!msg.error,
        at: now,
      };
      // Pressing Check is being present, as much as moving is.
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: row.pk, sk: row.sk },
        UpdateExpression: 'SET seen = :now, #m = :m',
        ExpressionAttributeNames: { '#m': 'mark' },
        ExpressionAttributeValues: { ':now': now, ':m': mark },
      })).catch(() => {});
      await emit(event, row.cohort, { type: 'marked', sub: row.sub, mark },
                 { except: id, only: 'tutor' });
      if (row.role !== 'tutor') await tallied(row.cohort, mark);
      return { statusCode: 200, body: 'ok' };
    }

    /**
 * One exercise's running tally, incremented.
 *
 * `ADD` RATHER THAN A READ AND A WRITE, because this is the one tally several students hit at
 * once - twelve people answering a question in the same ten seconds - and a read-modify-write
 * loses those by construction. The counters are the only part of the summary that is a race.
 *
 * The document path usually exists already: the educator's arrival at an exercise seeds it.
 * When it does not - a student answering something the class has not reached, which is
 * ordinary for somebody reading ahead - DynamoDB refuses the path and the seed happens here
 * instead. One extra write, on the uncommon branch, rather than two on every one.
 */
async function tallied(cohort, mark, seeded = false) {
  const bump = {
    TableName: TABLE, Key: sessionKey(cohort),
    UpdateExpression: 'ADD #ex.#id.#tried :one, #ex.#id.#right :r, '
      + '#ex.#id.#wrong :w, #ex.#id.#err :e',
    ConditionExpression: 'attribute_exists(sk)',
    ExpressionAttributeNames: {
      '#ex': 'ex', '#id': String(mark.exercise),
      '#tried': 'tried', '#right': 'right', '#wrong': 'wrong', '#err': 'err',
    },
    ExpressionAttributeValues: {
      ':one': 1,
      ':r': mark.pass ? 1 : 0,
      ':w': !mark.pass && !mark.error ? 1 : 0,
      ':e': mark.error ? 1 : 0,
    },
  };
  try {
    await ddb.send(new UpdateCommand(bump));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return;   // the session ended
    if (seeded) { console.error('tally not recorded', e.name, e.message); return; }
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: sessionKey(cohort),
      UpdateExpression: 'SET #ex.#id = if_not_exists(#ex.#id, :seed)',
      ConditionExpression: 'attribute_exists(sk)',
      ExpressionAttributeNames: { '#ex': 'ex', '#id': String(mark.exercise) },
      ExpressionAttributeValues: {
        ':seed': { title: '', tried: 0, right: 0, wrong: 0, err: 0 },
      },
    })).catch(() => {});
    await tallied(cohort, mark, true);
  }
}

/* ---- remote control ------------------------------------------------------
     *
     * ONE PERSON AT A TIME, PER SESSION, and it is a conditional write for the same reason
     * the session lock is: two admins reaching for the same student is a race, and a check
     * on the panel loses it. `attribute_not_exists(control) OR control.by = :me` also makes
     * re-taking your own control idempotent, which is what a reopened tab does.
     *
     * THE CLASS IS NOT TOLD WHOSE SCREEN IT IS UNTIL SHARING IS ON - but `controlling` goes
     * to the whole room regardless, because the student being driven has to be told, the
     * other tutors have to see the cohort is busy, and the class has to know when sharing
     * STOPS as well as when it starts. What sharing gates is what gets rendered, not what
     * gets said. */
    case 'control': {
      if (row.role !== 'tutor') return { statusCode: 200, body: 'not yours to take' };
      const target = String(msg.sub || '');
      if (!target) return { statusCode: 200, body: 'nobody named' };

      /* CONTROLLING SOMEBODY WHO IS NOT THERE IS NOT CONTROLLING ANYTHING. Their browser is
       * what applies a drive, so without a connection the admin would drive a screen that
       * does not exist and the student would arrive to find themselves already being
       * driven by somebody who has since given up. */
      const conns = await connectionsIn(row.cohort);
      const on = conns.find(c => c.sub === target);
      if (!on) {
        await to(event, id, { type: 'refused', what: 'control',
                              why: 'They are not connected to this session.' });
        return { statusCode: 200, body: 'not here' };
      }

      const control = {
        sub: target, name: on.name || '',
        by: row.sub, byName: row.name || '',
        sharing: !!msg.sharing,
        at: now,
      };
      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: sessionKey(row.cohort),
          UpdateExpression: 'SET #c = :c',
          ConditionExpression:
            'attribute_exists(sk) AND (attribute_not_exists(#c) OR #c.#by = :me)',
          ExpressionAttributeNames: { '#c': 'control', '#by': 'by' },
          ExpressionAttributeValues: { ':c': control, ':me': row.sub },
        }));
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        const held = await sessionFor(row.cohort);
        await to(event, id, {
          type: 'refused', what: 'control',
          why: held?.control
            ? `${held.control.byName || 'Somebody else'} is already controlling `
              + `${held.control.name || 'a student'}.`
            : 'That session has ended.',
        });
        return { statusCode: 200, body: 'taken' };
      }
      await emit(event, row.cohort, { type: 'controlling', control });
      return { statusCode: 200, body: 'ok' };
    }

    /* THE SWITCH IS NOT A SECOND DECISION, it is the same one taken again. The moment to
     * stop showing somebody's screen arrives during the session rather than before it, so
     * this is the control band's toggle and screen 13's tickbox writing the same field. */
    case 'sharing': {
      if (row.role !== 'tutor') return { statusCode: 200, body: 'not yours' };
      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: sessionKey(row.cohort),
          UpdateExpression: 'SET #c.#sh = :on',
          ConditionExpression: '#c.#by = :me',
          ExpressionAttributeNames: { '#c': 'control', '#sh': 'sharing', '#by': 'by' },
          ExpressionAttributeValues: { ':on': !!msg.on, ':me': row.sub },
        }));
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        return { statusCode: 200, body: 'not yours' };
      }
      const held = await sessionFor(row.cohort);
      await emit(event, row.cohort, { type: 'controlling', control: held?.control || null });
      return { statusCode: 200, body: 'ok' };
    }

    /* EITHER SIDE MAY END IT, and the student's half is the one that matters. A screen
     * somebody else can drive without the person being able to stop them is not something
     * to ship - so this is not an admin-only route with a courtesy button on the student's
     * band, it is a route the student is entitled to and the condition says so. */
    case 'release': {
      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE, Key: sessionKey(row.cohort),
          UpdateExpression: 'REMOVE #c',
          ConditionExpression: '#c.#by = :me OR #c.#sub = :me',
          ExpressionAttributeNames: { '#c': 'control', '#by': 'by', '#sub': 'sub' },
          ExpressionAttributeValues: { ':me': row.sub },
        }));
      } catch (e) {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
        return { statusCode: 200, body: 'nothing to release' };
      }
      await emit(event, row.cohort, { type: 'controlling', control: null });
      return { statusCode: 200, body: 'ok' };
    }

    /* Where the controlled student's screen is to go.
     *
     * ADDRESSED TO ONE PERSON, and the class is not among them even while sharing is on.
     * The student's own browser applies it and then reports `active` like any other move,
     * so what the class follows is what that screen ACTUALLY shows rather than what it was
     * told to show. One hop longer and the only version that cannot drift.
     *
     * The session row is read rather than the sender's role trusted: `tutor` says they may
     * control somebody, not that they are the one who currently does. */
    case 'drive': {
      const held = await sessionFor(row.cohort);
      const c = held?.control;
      if (!c || c.by !== row.sub) return { statusCode: 200, body: 'not driving' };
      const at = msg.at == null ? null : String(msg.at).slice(0, 200);
      await emit(event, row.cohort, {
        type: 'driven',
        position: at === null ? null : {
          exercise: at,
          title: String(msg.title || '').slice(0, 200),
          slide: Number(msg.slide) || null,
        },
        /* THE EDITOR TRAVELS WITH THE POSITION, not on a message of its own. They change
         * together - moving to an exercise is also arriving at its starter code - and two
         * messages would let a screen show one exercise's prompt over another's buffer for
         * however long the second took to arrive. Undefined rather than empty when there is
         * nothing to send, so a drive that is only a navigation does not blank an editor. */
        code: typeof msg.code === 'string' ? msg.code.slice(0, EDITOR_LIMIT) : undefined,
        /* WHERE THE DRIVER'S CARET IS, so the student can see somebody in the room rather
         * than text changing by itself. Travels with the buffer because it describes a
         * position IN that buffer - sent separately, a caret would arrive against text that
         * had not changed yet and point at the wrong character. */
        cursor: Number.isFinite(Number(msg.cursor)) && msg.cursor != null
          ? Number(msg.cursor) : undefined,
        at: now,
      }, { sub: c.sub });
      return { statusCode: 200, body: 'ok' };
    }

    /* THE OTHER DIRECTION, and it is the half that makes control useful. An educator taking
     * over someone who is stuck needs to see WHAT THEY WROTE - the progress rows hold only
     * the code that solved an exercise, so a student in the middle of getting it wrong has
     * nothing recorded anywhere.
     *
     * Sent by the controlled student, once, when control begins, and addressed to whoever is
     * driving. Not a stream: the student's editor is read-only for as long as they are being
     * driven, so there is nothing after the first send that could have changed. */
    case 'buffer': {
      const held = await sessionFor(row.cohort);
      const c = held?.control;
      if (!c || c.sub !== row.sub) return { statusCode: 200, body: 'not being driven' };
      await emit(event, row.cohort, {
        type: 'buffer',
        sub: row.sub,
        at: msg.at == null ? null : String(msg.at).slice(0, 200),
        code: String(msg.code ?? '').slice(0, EDITOR_LIMIT),
      }, { sub: c.by });
      return { statusCode: 200, body: 'ok' };
    }

    /* Ask again. A client that has just reconnected - a lid, a tunnel, API Gateway's
     * two-hour cap - has a roster from before it went away, and every join and leave in
     * between happened to somebody who was not listening. */
    case 'roster': {
      const held = await sessionFor(row.cohort);
      await to(event, id, {
        type: 'roster',
        /* Control rides the roster for the same reason the rest of it does: a client that
         * has just connected, or just come back from a tunnel, would otherwise not know a
         * classmate's screen was being shown until the next time it changed. */
        control: held?.control || null,
        members: await membersOf(row.cohort),
        here: (await connectionsIn(row.cohort)).map(c => ({
          sub: c.sub, name: c.name, role: c.role, seen: c.seen, position: c.position || null,
          /* Same rule as the broadcast, applied to the pull: a roster asked for by a student
           * comes back without anybody's mark on it. The asker's own role is on the row this
           * function read to find the cohort, so there is nothing to trust here either. */
          ...(row.role === 'tutor' ? { mark: c.mark || null } : {}),
        })),
      });
      return { statusCode: 200, body: 'ok' };
    }

    /* What somebody joined ten minutes in has missed. Asked on open, like `roster`, and for
     * the same reason: a client that reconnects after a tunnel has whatever it knew before
     * the gap, and everything said during it was said to somebody who was not listening.
     *
     * Separate from `roster` rather than folded into it, because the two go stale at
     * different rates and a chat panel is allowed to be closed. A reader that has to ask
     * for the roster in order to catch up on chat is a round trip spent on a list nothing
     * is going to draw. */
    case 'history': {
      const held = await sessionFor(row.cohort);
      await to(event, id, { type: 'history', messages: held?.chat || [] });
      return { statusCode: 200, body: 'ok' };
    }

    /* Chat. One client's words reach every client in the same cohort and no one else -
     * which was this route's whole job when it was only a smoke test, and still is.
     *
     * THE SENDER HEARS THEIR OWN, and that is deliberate: the server assigns the id and the
     * time, so every client in the room draws the same list in the same order. Echoing
     * locally and skipping the sender would give the person who typed it a slightly
     * different transcript from everybody else's - which is the one thing a transcript
     * must not be. */
    case 'say': {
      const text = String(msg.text ?? '').trim().slice(0, CHAT_CHARS);
      if (!text) return { statusCode: 200, body: 'nothing to say' };

      /* WHERE IT WAS SENT FROM, taken from the connection row rather than from the message.
       * The client reports its position on every move already, so asking it to say where it
       * is a second time would be a second copy of a fact to keep in step with the first -
       * and the one the panel draws would be the one that went stale. A question asked from
       * inside an exercise can then be OPENED rather than located. */
      const said = {
        id: randomUUID(),
        sub: row.sub, from: row.name, role: row.role,
        text, at: now,
        where: row.position || null,
      };

      /* Saying something is being present, and it is the one message that says so without
       * an `active` beside it. */
      await ddb.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: row.pk, sk: row.sk },
        UpdateExpression: 'SET seen = :now',
        ExpressionAttributeValues: { ':now': now },
      })).catch(() => {});

      await keep(row.cohort, said);

      const heard = await emit(event, row.cohort, { type: 'said', ...said });
      await to(event, id, { type: 'delivered', heard });
      return { statusCode: 200, body: 'ok' };
    }

    default:
      await to(event, id, { type: 'error', error: `unknown message type: ${msg.type}` });
      return { statusCode: 200, body: 'ok' };
  }
}

export async function handler(event) {
  // An HTTP API event has `requestContext.http`; a socket event has `routeKey`. Nothing
  // needs a mode flag to tell them apart.
  if (event.requestContext?.http) {
    const { method, path } = event.requestContext.http;
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    if (!claims?.sub) return json(401, { error: 'not signed in' });

    if (path.endsWith('/ticket')) {
      return method === 'POST' ? mint(event, claims)
        : json(405, { error: `${method} not allowed` });
    }

    /* Reading who is live is not an admin question - a student's client has to know a
     * session exists before it can offer to join one. Starting and ending are, and the
     * check is here because a JWT authorizer cannot see groups. */
    if (method === 'GET') return readSession(event, claims);
    if (!isAdmin(claims)) return json(403, { error: 'admins only' });
    if (method === 'POST') return start(event, claims);
    if (method === 'DELETE') return end(event, claims);
    return json(405, { error: `${method} not allowed` });
  }

  switch (event.requestContext?.routeKey) {
    case '$connect': return connect(event);
    case '$disconnect': return disconnect(event);
    case '$default': return message(event);
    default: return { statusCode: 400, body: 'unknown route' };
  }
}
