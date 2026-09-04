/* SAVED WHITEBOARDS: what an educator drew, kept for the class they drew it for.
 *
 *   GET  /api/boards?course=<id>                       -> { boards: [...] }   no pages
 *   GET  /api/boards?course=<id>&cohort=<id>           -> ...one named class's, for its educator
 *   GET  /api/boards?cohort=&topic=&board=             -> { board, pages: [svg] }
 *   POST   /api/boards   { cohort, course, topic, title, pages: [svg], board? } -> { board }
 *   DELETE /api/boards?cohort=&topic=&board=           -> { ok: true }
 *
 * THE LISTING IS ONE CALL PER COURSE, NOT PER TOPIC. A paperclip has to be drawable on every
 * row of a course, and asking on each navigation would be a round trip a student pays for by
 * moving. So this answers with every board of that course across their intakes at once and
 * the client indexes it by topic - which is also what lets the two places that draw the
 * paperclip read one lookup rather than each asking their own question.
 *
 * WHOSE BOARDS: the caller's own cohorts, resolved from their sub and never from anything the
 * request supplies. An admin therefore sees none of their own accord, which is correct and is
 * the same shape as their empty enrolment list - an admin is not in the class.
 *
 * AN EDUCATOR REACHES A BOARD THROUGH THE COHORT, WHILE DELIVERING TO IT, which is the whole
 * of `?cohort=`. A board belongs to the class it was drawn for and an educator's list does not
 * span cohorts - see WHITEBOARD.md - so this is not a second, wider way in: it is the same
 * scope named explicitly by somebody who is standing in front of that class. Last term's
 * diagram is not available to this term's intake, and that is the decision rather than a
 * limitation of the query.
 *
 * A BOARD BELONGS TO A COHORT, NOT TO A TOPIC AND NOT TO A COURSE, and that is the rule this
 * function exists to enforce rather than a detail of the keys. An artefact anchored to a
 * topic and shown to everybody is course material authored in the platform, and the first
 * rule in CLAUDE.md is that the platform may read content and must never write it. Scoped to
 * the cohort it is what it actually is: the record of one class's lesson, most useful to
 * whoever missed it. See WHITEBOARD.md.
 *
 *   pk  COHORT#<cohort>
 *   sk  BOARD#<topic>#<board>            the board - title, who, when, how many pages
 *   sk  BOARD#<topic>#<board>#<n>        one page, its SVG
 *
 * A fresh partition rather than a new prefix in a crowded one: the cohort row is
 * `COHORTS`/`COHORT#<id>` and membership is `USER#<sub>`/`COHORT#<id>`, so `COHORT#<id>` as a
 * PARTITION key was unused. One query on `begins_with(sk, 'BOARD#<topic>#')` is a topic's
 * boards and their pages together.
 *
 * ONE ROW PER PAGE. A DynamoDB item is capped at 400KB and a board at the transport ceiling
 * is most of that; pages are already the unit everything else about this works in.
 *
 * THE HEADER IS WRITTEN LAST, AND IT IS THE COMMIT. Nothing reads a page except through the
 * board that names it, so a save that dies half way leaves rows nobody can reach rather than
 * half a lesson somebody can. Re-saving the same board id overwrites in place, which is what
 * makes a board a document rather than a snapshot.
 *
 * WHO MAY WRITE IS NOT "A TUTOR". It is whoever is DELIVERING to that cohort right now, read
 * off the live session row - the same gate the socket applies to the board itself. A tutor
 * may run a lesson; it does not follow that they may write into this class's history.
 *
 * DELETING IS GATED EXACTLY LIKE SAVING, and deliberately NOT like reading. `mayRead` lets a
 * member in, because a board is theirs to look at; deleting it is not, and a student removing
 * their class's lesson would be the same gesture as tidying up their own notes. Whoever may
 * write may delete, and nobody else - which today means the person standing in front of the
 * class.
 *
 * NOT FILTERED HERE, deliberately. svgclean.js is a DOM filter and the boundary it guards is
 * `innerHTML`, which is in a browser; a copy of it in Node would be a second definition of a
 * closed vocabulary, drifting from the one that matters. What this does instead is BOUND the
 * bytes, which is the part a row cares about.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, QueryCommand, BatchWriteCommand, PutCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE;

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/* Mirrors PAGE_LIMIT in board.js, which is itself decksync.js's CAP: what a page may weigh
 * is one number and the client is where it is enforced usefully - it can say so to the
 * person drawing. This is the row's backstop. */
const PAGE_CHARS = 24 * 1024;
/* A lesson, not an archive. Forty pages is already a long morning at a board. */
const PAGES = 40;
const TITLE_CHARS = 120;
/* DynamoDB takes 25 writes a batch. */
const BATCH = 25;

/* Closed shapes, checked rather than escaped - pointer.js's argument, and here they are also
 * being concatenated into a sort key, where a stray `#` would silently address a different
 * row. A topic is `1.1.1`; a course id is a slug; a board id is generated below. */
const COHORT = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const COURSE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const TOPIC = /^[0-9]+(\.[0-9]+){0,3}$/;
const BOARD = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* Sortable, so a topic's boards come back in the order they were drawn without an index or a
 * sort. Base 36 milliseconds stays the same width until 2059, and the suffix is only there so
 * two boards saved in the same millisecond are two boards. */
const newBoardId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const claimsOf = event => event.requestContext?.authorizer?.jwt?.claims || {};

/** Is this caller the one delivering to that cohort, right now. */
async function delivering(cohort, sub) {
  const r = await ddb.send(new GetCommand({
    TableName: TABLE, Key: { pk: 'COHORTS', sk: `LIVE#${cohort}` },
  }));
  return !!r.Item && r.Item.by === sub;
}

const headerKey = (cohort, topic, board) =>
  ({ pk: `COHORT#${cohort}`, sk: `BOARD#${topic}#${board}` });
const pageKey = (cohort, topic, board, n) =>
  ({ pk: `COHORT#${cohort}`, sk: `BOARD#${topic}#${board}#${n}` });

async function write(requests) {
  for (let i = 0; i < requests.length; i += BATCH) {
    let unprocessed = { [TABLE]: requests.slice(i, i + BATCH) };
    /* BatchWriteItem may decline part of a batch under throttling and reports it rather than
     * failing - a caller that ignores `UnprocessedItems` loses pages silently, which here is
     * a hole in the middle of a lesson. */
    for (let tries = 0; tries < 4 && unprocessed?.[TABLE]?.length; tries++) {
      const r = await ddb.send(new BatchWriteCommand({ RequestItems: unprocessed }));
      unprocessed = r.UnprocessedItems || {};
    }
    if (unprocessed?.[TABLE]?.length) throw new Error('could not write every page');
  }
}

/** Every page of a query. A cohort's boards are few; "few" is not something a list should
 *  quietly depend on, and a truncated page here reads as a lesson having gone missing. */
async function queryAll(params) {
  const rows = [];
  let start;
  do {
    const r = await ddb.send(new QueryCommand({ ...params, ExclusiveStartKey: start }));
    rows.push(...(r.Items || []));
    start = r.LastEvaluatedKey;
  } while (start);
  return rows;
}

/** The intakes this person is in. The same query the session function opens the app with. */
async function cohortsOf(sub) {
  const rows = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'COHORT#' },
    ProjectionExpression: 'sk',
  });
  return rows.map(r => r.sk.slice('COHORT#'.length));
}

/* A HEADER, NOT A PAGE. Both live under the same prefix and are told apart by the number of
 * segments: `BOARD#<topic>#<board>` is the board and `BOARD#<topic>#<board>#<n>` is one of
 * its pages. Reading them as one query is the point of keying them that way. */
const isHeader = row => String(row.sk || '').split('#').length === 3;

/* MAY THIS CALLER SEE THIS CLASS'S BOARDS. Two ways in and no third: being in the class, or
 * standing in front of it right now. Membership is a row and delivering is a row; neither is
 * a role, which is the point - `tutor` says somebody may run a lesson, not that they may read
 * this class's history. */
async function mayRead(cohort, sub) {
  const [mine, live] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: TABLE, Key: { pk: `USER#${sub}`, sk: `COHORT#${cohort}` },
      ProjectionExpression: 'sk',
    })),
    ddb.send(new GetCommand({
      TableName: TABLE, Key: { pk: 'COHORTS', sk: `LIVE#${cohort}` },
      /* `by` IS A DYNAMODB RESERVED WORD and has to be aliased. Unaliased it is not a wrong
       * answer, it is a ValidationException - so this threw 500 on every read that reached
       * it, which was a student opening a board and an educator's whole listing. Caught by
       * nothing until it ran: see the projection check in test/setup-checks.mjs, which exists
       * because of this line. */
      ProjectionExpression: '#by',
      ExpressionAttributeNames: { '#by': 'by' },
    })),
  ]);
  return !!mine.Item || live.Item?.by === sub;
}

async function list(course, sub, only) {
  if (!COURSE.test(course)) return json(400, { error: 'which course' });
  if (only && !COHORT.test(only)) return json(400, { error: 'which cohort' });
  if (only && !await mayRead(only, sub)) return json(404, { error: 'no such class' });
  const cohorts = only ? [only] : await cohortsOf(sub);
  const found = await Promise.all(cohorts.map(async cohort => {
    const rows = await queryAll({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': `COHORT#${cohort}`, ':sk': 'BOARD#' },
      /* `svg` is deliberately not projected. A course's boards are a list; the pages are a
       * second call, made when somebody actually opens one. */
      ProjectionExpression: 'sk, board, course, topic, title, byName, #at, pages',
      ExpressionAttributeNames: { '#at': 'at' },
    });
    return rows.filter(r => isHeader(r) && r.course === course)
      .map(r => ({
        cohort, board: r.board, topic: r.topic, title: r.title,
        byName: r.byName || '', at: r.at, pages: Number(r.pages) || 0,
      }));
  }));
  /* Oldest first within a topic, which is how they were drawn - the board id is base-36
   * milliseconds, so the query already returns them that way and this only flattens. */
  return json(200, { boards: found.flat() });
}

async function one(cohort, topic, board, sub) {
  if (!COHORT.test(cohort) || !TOPIC.test(topic) || !BOARD.test(board)) {
    return json(400, { error: 'which board' });
  }
  /* ACCESS IS CHECKED, not inferred from knowing the keys. A board is one class's, and the id
   * travels through a browser - so this asks the same question the listing does rather than
   * trusting that whoever holds a key was given it by us. */
  if (!await mayRead(cohort, sub)) return json(404, { error: 'no such board' });

  const rows = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `COHORT#${cohort}`, ':sk': `BOARD#${topic}#${board}` },
  });
  const header = rows.find(isHeader);
  if (!header) return json(404, { error: 'no such board' });

  /* Ordered by the page number in the key, numerically. Sorted here rather than trusted from
   * the query: DynamoDB sorts a key as TEXT, so page 10 comes back between 1 and 2. */
  const pages = rows.filter(r => !isHeader(r))
    .map(r => ({ n: Number(String(r.sk).split('#').pop()), svg: String(r.svg || '') }))
    .sort((a, b) => a.n - b.n)
    .map(p => p.svg);

  return json(200, {
    board: {
      cohort, board, topic: header.topic, title: header.title,
      byName: header.byName || '', at: header.at, pages: pages.length,
    },
    pages,
  });
}

/* GONE MEANS GONE. There is no archive flag here and no soft delete: a board is one class's
 * record of one lesson, and an educator removing a false start wants it removed. The header
 * goes LAST, mirroring the save - so a delete that dies half way leaves rows nothing can
 * reach rather than a board that opens onto missing pages. */
async function remove(cohort, topic, board, sub) {
  if (!COHORT.test(cohort) || !TOPIC.test(topic) || !BOARD.test(board)) {
    return json(400, { error: 'which board' });
  }
  if (!await delivering(cohort, sub)) {
    return json(409, { error: 'you are not delivering to that class' });
  }
  const was = await ddb.send(new GetCommand({
    TableName: TABLE, Key: headerKey(cohort, topic, board), ProjectionExpression: 'pages',
  }));
  if (!was.Item) return json(404, { error: 'no such board' });

  const count = Number(was.Item.pages) || 0;
  await write(Array.from({ length: count }, (_, n) => ({
    DeleteRequest: { Key: pageKey(cohort, topic, board, n) },
  })));
  await ddb.send(new DeleteCommand({
    TableName: TABLE, Key: headerKey(cohort, topic, board),
  }));
  return json(200, { ok: true, pages: count });
}

async function save(event, sub, name) {
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'not JSON' }); }

  const cohort = String(body.cohort || '');
  const course = String(body.course || '');
  const topic = String(body.topic || '');
  if (!COHORT.test(cohort)) return json(400, { error: 'which cohort' });
  if (!COURSE.test(course)) return json(400, { error: 'which course' });
  if (!TOPIC.test(topic)) return json(400, { error: 'which topic' });

  if (!await delivering(cohort, sub)) {
    /* Not 403 as a matter of taste: the caller may be a perfectly good tutor, and what is
     * missing is a lesson rather than a right. */
    return json(409, { error: 'you are not delivering to that class' });
  }

  const pages = Array.isArray(body.pages) ? body.pages.map(p => String(p ?? '')) : [];
  if (!pages.length) return json(400, { error: 'a board with no pages' });
  if (pages.length > PAGES) return json(413, { error: `more than ${PAGES} pages` });
  if (pages.some(p => p.length > PAGE_CHARS)) return json(413, { error: 'a page is too big' });

  const board = BOARD.test(String(body.board || '')) ? String(body.board) : newBoardId();
  const title = String(body.title || '').trim().slice(0, TITLE_CHARS) || 'Whiteboard';

  /* RE-SAVING A SHORTER BOARD LEAVES ITS OLD TAIL BEHIND. Nothing would read those rows -
   * the header says how many pages there are - but a document that is edited for a term
   * would accumulate them, so they go. Read first, because the count is the only way to
   * know how far the old one reached. */
  const was = await ddb.send(new GetCommand({
    TableName: TABLE, Key: headerKey(cohort, topic, board), ProjectionExpression: 'pages',
  }));
  const before = Number(was.Item?.pages) || 0;

  const now = new Date().toISOString();
  await write([
    ...pages.map((svg, n) => ({
      PutRequest: { Item: { ...pageKey(cohort, topic, board, n), svg } },
    })),
    ...Array.from({ length: Math.max(0, before - pages.length) }, (_, i) => ({
      DeleteRequest: { Key: pageKey(cohort, topic, board, pages.length + i) },
    })),
  ]);

  /* The commit. `by` is the sub and `byName` is a cache of the name, exactly as a membership
   * row caches it - so a list of boards can say who drew one without a call to the pool. */
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...headerKey(cohort, topic, board),
      board, course, topic, title,
      by: sub, byName: name || '',
      at: now, pages: pages.length,
    },
  }));

  return json(200, { board, pages: pages.length, at: now, title });
}

export async function handler(event) {
  const claims = claimsOf(event);
  const sub = claims.sub;
  if (!sub) return json(401, { error: 'not signed in' });

  const method = event.requestContext?.http?.method;
  if (method === 'POST') return save(event, sub, claims.name);
  if (method === 'DELETE') {
    const q = event.queryStringParameters || {};
    return remove(String(q.cohort || ''), String(q.topic || ''), String(q.board || ''), sub);
  }
  if (method === 'GET') {
    const q = event.queryStringParameters || {};
    /* Told apart by which parameters are present rather than by a mode flag, the way the
     * progress function's two GETs are: one names a course, the other names a board. */
    if (q.board) return one(String(q.cohort || ''), String(q.topic || ''), String(q.board), sub);
    return list(String(q.course || ''), sub, q.cohort ? String(q.cohort) : null);
  }
  return json(405, { error: 'method not allowed' });
}
