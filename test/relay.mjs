/* The live Lambda's fan-out, run for real against a local server.
 *
 * THE LEAK THIS GUARDS AGAINST NEVER SHOWED IN A METRIC. `managementFor` built a new API Gateway
 * client on every call, every client brought its own pool of keep-alive connections, and so
 * every post to every student opened a fresh HTTPS connection and left it open. A warm
 * container piled them up until DNS lookups failed with `getaddrinfo EBUSY`, and 2,850 posts in
 * one lesson went nowhere - swallowed, as `emit` swallows every failure, so the Errors metric
 * read zero throughout. See LIVE-RELIABILITY.md.
 *
 * So this counts CONNECTIONS, at the server end, which is the one number that moves when the
 * bug is back. Thirty fan-outs to nine students is 270 posts: the leaking version opens 270
 * connections and leaves every one open; the fixed one opens a handful and reuses them.
 *
 * The real SDK and the real `emit`, with the endpoint pointed at 127.0.0.1 and throwaway
 * credentials in the environment - nothing leaves the machine. It needs infra's dependencies,
 * which is where the SDK is installed, and says so rather than failing when they are absent.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

const SDK = path.join(import.meta.dirname, '..', 'infra', 'node_modules',
                      '@aws-sdk', 'client-apigatewaymanagementapi');
if (!existsSync(SDK)) {
  console.log('SKIP  relay: infra/node_modules is not installed (npm ci --prefix infra)');
  process.exit(0);
}

/* A server that answers every post and counts the connections it is asked to accept. It keeps
 * idle ones open for a minute, as a real front door does - which is what made the leak a leak:
 * nothing on the far side was going to close them either.
 *
 * IT IS DYNAMODB TOO, for the second half of this file: a post answered Gone makes `emit` delete
 * a row, and a message from a socket with no row makes the Lambda close it. So it answers `Gone`
 * for the connection ids in `gone`, records every connection it is asked to close, and speaks
 * just enough of DynamoDB's protocol to record deletes and queries and find nothing. */
let accepted = 0, open = 0;
const gone = new Set();
const closedIds = [], deleted = [], queries = [], posts = [];
/* The one connection the stand-in has a row for, so a message from it is handled rather than
 * closed. In DynamoDB's own wire format, which is what the SDK unpacks. */
const TESTER = { pk: { S: 'CONN#tester' }, sk: { S: 'LIVECONN#relay' }, sub: { S: 'tester' },
                 role: { S: 'student' }, cohort: { S: 'relay' }, name: { S: 'Tester' } };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const target = req.headers['x-amz-target'] || '';
    if (target.startsWith('DynamoDB_')) {
      const input = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/x-amz-json-1.0');
      if (target.endsWith('.DeleteItem')) deleted.push(input.Key?.pk?.S);
      if (target.endsWith('.Query')) {
        queries.push(input);
        const mine = input.ExpressionAttributeValues?.[':pk']?.S === 'CONN#tester';
        return res.end(JSON.stringify(mine ? { Items: [TESTER], Count: 1 } : { Items: [], Count: 0 }));
      }
      return res.end('{}');
    }
    const id = decodeURIComponent((/@connections\/([^/?]+)/.exec(req.url) || [])[1] || '');
    if (req.method === 'DELETE') { closedIds.push(id); return res.end(''); }
    posts.push({ id, body });
    if (gone.has(id)) {
      res.statusCode = 410;
      res.setHeader('x-amzn-errortype', 'GoneException');
      res.setHeader('content-type', 'application/json');
      return res.end('{"message":"Gone"}');
    }
    res.end('');
  });
});
server.keepAliveTimeout = 60_000;
server.on('connection', s => { accepted++; open++; s.on('close', () => open--); });
await new Promise(r => server.listen(0, '127.0.0.1', r));

// Set before the module loads: it reads its environment at import and at call.
process.env.WS_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
process.env.AWS_REGION = 'eu-south-1';
process.env.AWS_ACCESS_KEY_ID = 'relay-test';
process.env.AWS_SECRET_ACCESS_KEY = 'relay-test';
process.env.TABLE = 'relay-test';
process.env.AWS_ENDPOINT_URL_DYNAMODB = process.env.WS_ENDPOINT;
const { emit, managementFor, handler } = await import('../infra/lambda/live/index.mjs');

const event = { requestContext: { apiId: 'relay', stage: 'test' } };
check('the same client comes back on every call', managementFor(event) === managementFor(event));

/* Nine students, as `emit` would have read them from the roster. Passed as `from` so no table
 * is consulted - the fan-out is what is under test, not the query in front of it. */
const room = Array.from({ length: 9 }, (_, i) => ({
  pk: `CONN#student-${i}`, sk: 'LIVECONN#relay', sub: `student-${i}`, role: 'student',
}));

let heard = 0;
for (let m = 0; m < 30; m++) {
  heard += await emit(event, 'relay', { type: 'synced', code: `message ${m}` }, { from: room });
}
check('every one of the 270 posts was delivered', heard === 270, `${heard} delivered`);
check('connections are reused, not opened per post (at most 3 per student)',
      accepted <= 27, `${accepted} connections opened for 270 posts - the leak is back`);

/* A SECOND "INVOCATION" in the same container, which is the case that matters: the leak
 * accumulated across invocations, so a warm container is where reuse has to show. */
const before = accepted;
for (let m = 0; m < 10; m++) await emit(event, 'relay', { type: 'synced', code: `again ${m}` }, { from: room });
check('a later invocation in the same container opens nothing new', accepted - before <= 9,
      `${accepted - before} more connections for 90 posts`);

/* ---- A POST THAT COMES BACK GONE -------------------------------------------
 *
 * Routine for a socket that died without a `$disconnect`: the row is stale and is forgotten. NOT
 * for one still arriving - API Gateway answers Gone until a connection's `$connect` has returned,
 * and that handler writes the row first. Forgetting that row left a student who had just joined
 * on an open socket that nothing was ever sent to again.
 */
{
  const ago = ms => new Date(Date.now() - ms).toISOString();
  gone.add('arriving');
  gone.add('stale');
  const rows = [
    { pk: 'CONN#arriving', sk: 'LIVECONN#relay', sub: 'a', role: 'student', at: ago(400) },
    { pk: 'CONN#stale', sk: 'LIVECONN#relay', sub: 's', role: 'student', at: ago(60_000) },
  ];
  const heardBy = await emit(event, 'relay', { type: 'synced', code: 'gone?' }, { from: rows });
  check('a connection answering Gone is not counted as having heard', heardBy === 0, `${heardBy}`);
  check('a stale one is forgotten', deleted.includes('CONN#stale'), JSON.stringify(deleted));
  check('one still arriving is not', !deleted.includes('CONN#arriving'), JSON.stringify(deleted));
}

/* ---- A SOCKET THE LAMBDA HAS NO ROW FOR -----------------------------------
 *
 * Nothing is sent to it and nothing it says is answered, so ignoring it left a student in a room
 * that could not hear them until their heartbeat gave up, a minute later. It is closed instead,
 * and the client reconnects at once. The read that decides this must be consistent, or a socket
 * whose row was written a moment ago would be closed for arriving.
 */
{
  await handler({
    requestContext: { routeKey: '$default', connectionId: 'ghost', apiId: 'relay', stage: 'test' },
    body: JSON.stringify({ type: 'ping' }),
  });
  check('the row is read consistently', queries.at(-1)?.ConsistentRead === true,
        JSON.stringify(queries.at(-1)));
  check('a socket with no row is closed, so the client reconnects', closedIds.includes('ghost'),
        JSON.stringify(closedIds));
}

/* ---- THE LIGHT ROSTER -------------------------------------------------------
 *
 * Asked for every thirty seconds by every client in a lesson, to repair any discrete message it
 * missed. It leaves out the members, which cannot change and are the costliest part, and the
 * board's drawing, which a client must not re-apply on a timer - saying only whether a board
 * is up. A full roster still carries both.
 */
{
  const ask = async light => {
    posts.length = 0;
    await handler({
      requestContext: { routeKey: '$default', connectionId: 'tester', apiId: 'relay', stage: 'test' },
      body: JSON.stringify(light ? { type: 'roster', light: true } : { type: 'roster' }),
    });
    const p = posts.find(x => x.id === 'tester');
    return p ? JSON.parse(p.body) : null;
  };
  const lightOne = await ask(true);
  check('a light roster says it is one, and whether a board is up',
        lightOne?.light === true && typeof lightOne.boardOn === 'boolean',
        JSON.stringify(lightOne)?.slice(0, 200));
  check('and leaves out the members and the drawing',
        lightOne && !('members' in lightOne) && !('board' in lightOne),
        JSON.stringify(lightOne)?.slice(0, 200));
  const full = await ask(false);
  check('a full roster still carries both', full && 'members' in full && 'board' in full,
        JSON.stringify(full)?.slice(0, 200));
}

managementFor(event).destroy();
server.closeAllConnections();
server.close();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
