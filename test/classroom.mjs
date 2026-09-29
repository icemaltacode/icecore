/* A synthetic classroom, against the real deployment.
 *
 *   AWS_PROFILE=ice npm run test:classroom -- [--students 12] [--minutes 12] [--label before]
 *                                              [--out results.json]
 *   AWS_PROFILE=ice npm run test:classroom -- --oversize
 *
 * Phase 0 of LIVE-RELIABILITY.md. One educator socket and a room of student sockets, playing a
 * lesson's traffic through the real API Gateway and the real Lambda, and counting what arrives.
 * It exists so that a fix to the live channel is measured before a class meets it, rather than
 * discovered in one.
 *
 * WHAT IT MEASURES IS WHAT A STUDENT WOULD SEE, not what the Lambda thinks it did:
 *
 *   - after typing stops, is this student's copy of the editor the last thing typed?
 *   - after the pen lifts, does this student hold the last drawing?
 *   - two seconds after the educator moves, is this student's idea of where they are right?
 *
 * Every one of those has been wrong in a real lesson, and the Lambda's own metrics said nothing
 * about any of them - it swallowed the failures. So the count comes from the far end.
 *
 * IT FORGES ITS OWN TICKETS, and needs no password. A ticket is a row, and the `ice` profile can
 * write rows, so this starts at `$connect` - which is where every fault on the channel lives.
 * The HTTP half (signing in, minting a ticket through the authorizer) is `test:live`'s job.
 *
 * IT WORKS IN A COHORT OF ITS OWN (`zz-synthetic-*`), writes a session row, and removes
 * everything it wrote in a `finally`. It writes no history row and no bookmark, because it never
 * ends the session through the route that writes them.
 *
 * IT REFUSES TO RUN DURING A LESSON. It shares the Lambda's containers with every real class,
 * and against the deployment this was written to measure, degrading those containers is exactly
 * what it does. `--anyway` overrides, and should not be used.
 *
 * The traffic is today's lesson compressed: 2026-09-29 was about 4,700 invocations reaching
 * about eight people over 95 minutes, and the default here is roughly that many deliveries in
 * twelve. A 30-second cycle of typing, a pause, drawing and a pause, with a move every five
 * seconds throughout.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { split, assembler } from '../app/src/parts.js';

// ---------------------------------------------------------------- arguments
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const STUDENTS = Number(arg('students', 12));
const MINUTES = Number(arg('minutes', 12));
const LABEL = String(arg('label', 'run'));
const OUT = arg('out', null);
const OVERSIZE = arg('oversize', false) === true;

/* THE AWS SDK COMES FROM infra/, the one place it is installed. A machine without infra's
 * dependencies cannot run this at all, and says so rather than failing somewhere obscure. */
const require = createRequire(path.join(import.meta.dirname, '..', 'infra', 'package.json'));
let sdk;
try {
  sdk = {
    ...require('@aws-sdk/client-dynamodb'),
    ...require('@aws-sdk/lib-dynamodb'),
  };
} catch {
  console.log('SKIP  test:classroom -- infra/node_modules is not installed (npm ci --prefix infra)');
  process.exit(0);
}

// ---------------------------------------------------------------- the deployment
/* The default profile on this machine is a DIFFERENT account, which also has things in it. A
 * load test pointed at the wrong one is not a test. */
if (process.env.AWS_PROFILE !== 'ice') {
  console.log('REFUSED  set AWS_PROFILE=ice - the default profile is another account');
  process.exit(2);
}
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const REGION = execFileSync('aws', ['configure', 'get', 'region'], { encoding: 'utf8' }).trim();
const stack = aws('cloudformation', 'describe-stacks', '--stack-name', 'Icecore').Stacks[0];
const outputs = Object.fromEntries(stack.Outputs.map(o => [o.OutputKey, o.OutputValue]));
/* `list-`, not `describe-stack-resources`: the second stops at a hundred resources without
 * saying so, and this stack has more than that. */
const resources = aws('cloudformation', 'list-stack-resources', '--stack-name', 'Icecore')
  .StackResourceSummaries;
const physical = (type, test) =>
  resources.find(r => r.ResourceType === type && test(r.LogicalResourceId))?.PhysicalResourceId;
const TABLE = physical('AWS::DynamoDB::Table', id => id.startsWith('Table'));
const LOGS = physical('AWS::Logs::LogGroup', id => id.startsWith('LiveLogs'));
const SOCKET = outputs.LiveSocketUrl;
if (!TABLE || !LOGS || !SOCKET) {
  console.log('FAIL  could not find the table, the live log group or the socket URL', { TABLE, LOGS, SOCKET });
  process.exit(1);
}

const ddb = sdk.DynamoDBDocumentClient.from(new sdk.DynamoDBClient({ region: REGION }));
const epoch = s => Math.floor(Date.now() / 1000) + s;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const COHORT = `zz-synthetic-${Date.now().toString(36)}`;
const TUTOR = 'zz-synthetic-tutor';
const CHANNEL = 'Synthetic classroom - drawings';

// ---------------------------------------------------------------- not during a lesson
/* Asked before starting AND every thirty seconds while running, because a lesson can start in
 * the middle of a twelve-minute run - and walk into containers this has just degraded. */
async function lessonsRunning() {
  const r = await ddb.send(new sdk.QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': 'COHORTS', ':sk': 'LIVE#' },
  }));
  return arg('anyway') === true ? []
    : (r.Items || []).filter(i => !i.sk.startsWith('LIVE#zz-')).map(i => i.sk.slice(5));
}
{
  const real = await lessonsRunning();
  if (real.length) {
    console.log(`REFUSED  a lesson is running (${real.join(', ')}). `
      + 'This shares its Lambda containers, so it waits.');
    process.exit(2);
  }
}

// ---------------------------------------------------------------- the room
const opened = [];

async function connect(sub, name, role) {
  const ticket = randomUUID();
  await ddb.send(new sdk.PutCommand({
    TableName: TABLE,
    Item: {
      pk: `LIVE#TICKET#${ticket}`, sk: 'TICKET',
      sub, cohort: COHORT, role, name, email: '',
      expires: new Date(Date.now() + 60_000).toISOString(),
      ttl: epoch(300),
    },
  }));
  const ws = new WebSocket(`${SOCKET}?ticket=${encodeURIComponent(ticket)}`);
  const pieces = assembler();
  const client = {
    sub, name, role, ws,
    closed: null,
    pings: 0, pongs: 0,
    got: { push: new Map(), deck: new Map(), move: new Map() },
    max: { push: -1, deck: -1, move: -1 },
    last: { push: -1, deck: -1, move: -1 },   // the last to ARRIVE, which is what a screen shows
    disorder: { push: 0, deck: 0, move: 0 },
    heard: [],                                  // anything the educator is told, by type
    lastHeard: null,                            // performance.now() of the last frame of any kind
    rowGone: null,                              // when the Lambda's row for this socket vanished
  };
  const note = (kind, n, at) => {
    if (client.got[kind].has(n)) return;
    client.got[kind].set(n, at);
    if (n < client.max[kind]) client.disorder[kind] += 1;
    client.max[kind] = Math.max(client.max[kind], n);
    client.last[kind] = n;
  };
  ws.onmessage = e => {
    const at = performance.now();
    client.lastHeard = at;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'pong') client.pongs += 1;
    else if (m.type === 'synced') {
      const n = /^# push (\d+)/.exec(m.code || '')?.[1];
      if (n != null) note('push', Number(n), at);
    } else if (m.type === 'part') {
      // A deck patch too big for one frame, reassembled exactly as live.js does it.
      const whole = pieces.add(m);
      if (whole != null) {
        const inner = JSON.parse(whole);
        if (Number.isFinite(inner.seq)) note('deck', inner.seq, at);
      }
    } else if (m.type === 'decked') {
      if (Number.isFinite(m.seq)) note('deck', m.seq, at);
    } else if (m.type === 'moved') {
      const n = /^syn-(\d+)$/.exec(m.position?.exercise || '')?.[1];
      if (n != null) note('move', Number(n), at);
    } else client.heard.push({ type: m.type, at });
  };
  ws.onclose = e => { client.closed = { code: e.code, reason: e.reason, at: performance.now() }; };
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${sub} did not open`)), 15_000);
    ws.onopen = () => { clearTimeout(t); resolve(); };
    ws.onerror = () => { clearTimeout(t); reject(new Error(`${sub} failed to open`)); };
  });
  opened.push(client);
  return client;
}

const send = (client, msg) => {
  if (client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify(msg));
  return true;
};

async function cleanup() {
  for (const c of opened) { try { c.ws.close(); } catch { /* already gone */ } }
  await sleep(1500);
  const del = Key => ddb.send(new sdk.DeleteCommand({ TableName: TABLE, Key })).catch(() => {});
  await del({ pk: 'COHORTS', sk: `LIVE#${COHORT}` });
  /* The Lambda deletes a connection row on `$disconnect`; anything left means one never came,
   * and it would otherwise sit in the table for CONNECTION_HOURS. */
  const left = await ddb.send(new sdk.QueryCommand({
    TableName: TABLE, IndexName: 'byCourse',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeValues: { ':sk': `LIVECONN#${COHORT}` },
  })).catch(() => ({ Items: [] }));
  for (const i of left.Items || []) await del({ pk: i.pk, sk: i.sk });
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

// ---------------------------------------------------------------- measuring
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const spread = xs => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99),
                        max: xs.length ? Math.round(Math.max(...xs)) : null });

function insights(query, start, end) {
  const { queryId } = aws('logs', 'start-query', '--log-group-name', LOGS,
    '--start-time', String(Math.floor(start / 1000) - 5), '--end-time', String(Math.ceil(end / 1000) + 60),
    '--query-string', query, '--limit', '10000');
  for (;;) {
    const r = aws('logs', 'get-query-results', '--query-id', queryId);
    if (r.status === 'Complete' || r.status === 'Failed') {
      return r.results.map(row => Object.fromEntries(row.filter(c => c.field !== '@ptr')
        .map(c => [c.field, Number.isFinite(Number(c.value)) ? Number(c.value) : c.value])));
    }
    execFileSync('sleep', ['1']);
  }
}

// ---------------------------------------------------------------- the oversize probe
/* FAULT 1 IN ISOLATION: is a message over 32KB answered by closing the sender's connection?
 * AWS documents that it is; this asks the deployment. Node's WebSocket, like Chromium's, sends
 * one message as one frame. */
async function oversize() {
  const started = Date.now();
  await ddb.send(new sdk.PutCommand({ TableName: TABLE, Item: session() }));
  try {
    const tutor = await connect(TUTOR, 'Synthetic tutor', 'tutor');
    const student = await connect('zz-synthetic-student-01', 'Synthetic student 1', 'student');
    await sleep(2500);
    const results = [];
    /* One message at a time, whole or in parts, and the raw 40KB LAST - it is expected to
     * close the educator's socket, and nothing can be measured on a closed one. In parts, the
     * same sizes should arrive whole with the socket still open: that is Phase 2's fix. A
     * deployment that does not know `part` answers it with an error, and the patch reaches
     * nobody - which is the before-state, measured the same way. */
    const probes = [[16, 'whole'], [30, 'whole'], [40, 'parts'], [80, 'parts'], [200, 'parts'], [40, 'whole']];
    let seq = 0;
    for (const [kb, how] of probes) {
      if (tutor.ws.readyState !== WebSocket.OPEN) break;
      seq += 1;
      const msg = { type: 'deck', channel: CHANNEL, to: 'room', origin: 'probe', seq,
                    data: { 1: { keep: 0, add: ['x'.repeat(kb * 1024)], full: true } } };
      if (how === 'whole') send(tutor, msg);
      else {
        for (const p of split(JSON.stringify(msg), { type: 'part', of: 'deck', to: 'room' }, `probe-${seq}`)) {
          send(tutor, p);
        }
      }
      await sleep(4000);
      results.push({
        kb, how,
        educatorSocket: tutor.closed ? `closed ${tutor.closed.code}` : 'open',
        reachedStudent: student.got.deck.has(seq),
      });
    }
    console.table(results);
    return { label: LABEL, kind: 'oversize', startedAt: new Date(started).toISOString(), results };
  } finally {
    await cleanup();
  }
}

function session() {
  return {
    pk: 'COHORTS', sk: `LIVE#${COHORT}`,
    title: 'Synthetic classroom', course: 'zz-synthetic',
    at: new Date().toISOString(), by: TUTOR, name: 'Synthetic tutor',
    sharing: false, people: {}, ex: {}, covered: [],
    ttl: epoch(3 * 3600),
  };
}

// ---------------------------------------------------------------- the lesson
async function lesson() {
  await ddb.send(new sdk.PutCommand({ TableName: TABLE, Item: session() }));
  const started = Date.now();
  const t0run = performance.now();
  try {
    const tutor = await connect(TUTOR, 'Synthetic tutor', 'tutor');
    const students = [];
    for (let i = 1; i <= STUDENTS; i++) {
      const n = String(i).padStart(2, '0');
      students.push(await connect(`zz-synthetic-student-${n}`, `Synthetic student ${n}`, 'student'));
    }
    const everyone = [tutor, ...students];
    console.log(`${COHORT}: ${students.length} students and an educator connected`);

    /* Sharing on, through the real route, and waited for: the switch is the gate every push is
     * checked against. */
    send(tutor, { type: 'sync', on: true });
    await sleep(3000);

    const sent = { push: new Map(), deck: new Map(), move: new Map() };
    const checks = { push: [], deck: [], move: [] };   // did each student hold the latest, when it mattered
    let seq = { push: 0, deck: 0, move: 0 };
    let running = true;

    /* The heartbeat, as live.js sends it: every socket, every twenty seconds. */
    const beats = setInterval(() => {
      for (const c of everyone) if (send(c, { type: 'ping' })) c.pings += 1;
    }, 20_000);

    /* WHETHER EACH STUDENT IS STILL IN THE ROOM AS THE LAMBDA SEES IT. A socket can stay open
     * while its row is deleted - the Lambda deletes a row when a post to it comes back Gone -
     * and from then on nothing is sent to it and nothing it sends is answered, with no close to
     * say so. Found by a run where one student heard nothing for twelve minutes on an open
     * socket. Every five seconds, by sub. */
    const rows = setInterval(async () => {
      const r = await ddb.send(new sdk.QueryCommand({
        TableName: TABLE, IndexName: 'byCourse', KeyConditionExpression: 'sk = :sk',
        ExpressionAttributeValues: { ':sk': `LIVECONN#${COHORT}` },
      })).catch(() => null);
      if (!r) return;
      const here = new Set((r.Items || []).map(i => i.sub));
      for (const c of everyone) {
        if (!c.closed && c.rowGone == null && !here.has(c.sub)) {
          c.rowGone = performance.now();
          console.log(`ROW GONE  ${c.sub} at ${new Date().toISOString()}, socket still open`);
        }
      }
    }, 5000);

    let interrupted = null;
    const guard = setInterval(async () => {
      const real = await lessonsRunning().catch(() => []);
      if (real.length && running) {
        interrupted = real.join(', ');
        console.log(`STOPPING  a lesson has started (${interrupted})`);
        running = false;
      }
    }, 30_000);

    /* Whether every student is holding the newest thing of this kind, a moment after the
     * sender stopped. This is the measurement: "the editor is stale", "the drawing is
     * incomplete", "they did not follow". */
    const check = kind => {
      const latest = seq[kind] - 1;
      if (latest < 0) return;
      for (const s of students) {
        checks[kind].push({ latest, held: s.last[kind], ok: s.last[kind] === latest,
                            closed: !!s.closed });
      }
    };

    const moves = (async () => {
      while (running) {
        await sleep(5000);
        if (!running) break;
        const n = seq.move++;
        sent.move.set(n, performance.now());
        send(tutor, { type: 'active', at: `syn-${n}`, title: `Synthetic row ${n}`, slide: null });
        setTimeout(() => check('move'), 2000);
      }
    })();

    const stroke = (n, points) =>
      `<path d="M 10,10 ${Array.from({ length: points }, (_, i) =>
        `C ${100 + i}.12,${200 + n}.34 ${110 + i}.56,${210 + n}.78 ${120 + i}.9,${220 + n}.1`).join(' ')}"/>`;

    const ends = started + MINUTES * 60_000;
    let cycle = 0;
    while (running && Date.now() < ends) {
      // Typing: a push every 200ms for twelve seconds - someone typing at about five keys a second.
      for (let t = 0; t < 60 && Date.now() < ends; t++) {
        const n = seq.push++;
        sent.push.set(n, performance.now());
        send(tutor, { type: 'push', at: 'syn-editor', step: 0, cursor: 20 + t, anchor: null,
                      code: `# push ${n}\nSELECT synthetic_column_${t}\nFROM synthetic_table;\n` });
        await sleep(200);
      }
      await sleep(2500);
      check('push');
      await sleep(500);
      // Drawing: four strokes, ten frames a second while the pen moves, then the settle snapshot.
      for (let s = 0; s < 4 && Date.now() < ends; s++) {
        for (let f = 0; f < 15; f++) {
          const n = seq.deck++;
          sent.deck.set(n, performance.now());
          send(tutor, { type: 'deck', channel: CHANNEL, to: 'room', origin: 'synthetic', seq: n,
                        data: { [String(1 + (cycle % 5))]: { keep: s, add: [stroke(f, 4)] } } });
          await sleep(100);
        }
        await sleep(600);
        const n = seq.deck++;
        sent.deck.set(n, performance.now());
        send(tutor, { type: 'deck', channel: CHANNEL, to: 'room', origin: 'synthetic', seq: n,
                      data: { [String(1 + (cycle % 5))]: { keep: 0, full: true,
                                                            add: [stroke(99, 40), stroke(98, 40)] } } });
        await sleep(1000);
        check('deck');
        await sleep(400);
      }
      await sleep(3000);
      cycle += 1;
    }
    running = false;
    await moves;
    clearInterval(beats);
    clearInterval(guard);
    clearInterval(rows);
    if (interrupted) {
      await cleanup();
      console.log('ABANDONED  the numbers from a run cut short by a lesson are not a measurement');
      process.exit(3);
    }
    await sleep(5000);   // let the last deliveries land before counting
    const ended = Date.now();

    // ---------------------------------------------------------------- the count
    const result = { label: LABEL, kind: 'lesson', cohort: COHORT,
                     startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(),
                     students: students.length, minutes: MINUTES, sent: {}, delivery: {},
                     latencyMs: {}, disorder: {}, stale: {}, heartbeat: {}, closes: [],
                     /* Per student: when they last heard anything and when their row went,
                      * as seconds into the run, so a silent student can be put on a clock. */
                     perStudent: students.map(c => ({
                       sub: c.sub, pushes: c.got.push.size,
                       lastHeardSec: c.lastHeard == null ? null : Math.round((c.lastHeard - t0run) / 1000),
                       rowGoneSec: c.rowGone == null ? null : Math.round((c.rowGone - t0run) / 1000),
                     })) };
    for (const kind of ['push', 'deck', 'move']) {
      const expected = sent[kind].size * students.length;
      let received = 0, lostToAny = 0, lostToHalf = 0;
      const lat = [];
      for (const [n, t0] of sent[kind]) {
        let missing = 0;
        for (const s of students) {
          const t1 = s.got[kind].get(n);
          if (t1 == null) missing += 1;
          else { received += 1; lat.push(t1 - t0); }
        }
        if (missing) lostToAny += 1;
        if (missing >= students.length / 2) lostToHalf += 1;
      }
      result.sent[kind] = sent[kind].size;
      result.delivery[kind] = {
        expected, received, missing: expected - received,
        missingPct: expected ? +(100 * (expected - received) / expected).toFixed(2) : 0,
        messagesLostToSomeone: lostToAny, messagesLostToHalfTheRoom: lostToHalf,
      };
      result.latencyMs[kind] = spread(lat);
      result.disorder[kind] = students.reduce((n, s) => n + s.disorder[kind], 0);
      const c = checks[kind];
      result.stale[kind] = { checks: c.length, stale: c.filter(x => !x.ok).length,
                             stalePct: c.length ? +(100 * c.filter(x => !x.ok).length / c.length).toFixed(2) : 0 };
    }
    const pings = everyone.reduce((n, c) => n + c.pings, 0);
    const pongs = everyone.reduce((n, c) => n + c.pongs, 0);
    result.heartbeat = { pings, pongs, lost: pings - pongs };
    result.closes = everyone.filter(c => c.closed).map(c => ({ sub: c.sub, ...c.closed }));

    await cleanup();

    /* THE LAMBDA'S SIDE, for the same window. Logs reach Insights a little after they are
     * written, so this waits rather than reading a half-empty window. */
    console.log('waiting for the Lambda logs to arrive...');
    await sleep(60_000);
    const failures = insights(
      'filter @message like /ERROR/ | parse @message /ERROR\\t(?<kind>\\S+ \\S+)[^\\n]*?(?<err>EBUSY|AggregateError|ECONNRESET|\\w+Exception)/ | stats count() as n by kind, err',
      started, ended);
    const speed = insights(
      'filter @type = "REPORT" | stats count() as invocations, pct(@duration,50) as p50, pct(@duration,99) as p99, max(@duration) as max, count(@initDuration) as cold, max(@maxMemoryUsed/1000/1000) as memMB',
      started, ended);
    const containers = insights(
      'stats sum(@type="REPORT") as invocations, sum(@message like /EBUSY/) as ebusy, max(@maxMemoryUsed/1000/1000) as memMB by @logStream | sort invocations desc',
      started, ended);
    result.lambda = {
      failures,
      ...(speed[0] || {}),
      containers: containers.map(c => ({ invocations: c.invocations, ebusy: c.ebusy, memMB: c.memMB })),
    };
    return result;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

// ---------------------------------------------------------------- run
const result = OVERSIZE ? await oversize() : await lesson();
if (!OVERSIZE) {
  const r = result;
  console.log(`\n${r.label}: ${r.students} students, ${r.minutes} minutes, ${r.cohort}`);
  console.table(Object.fromEntries(['push', 'deck', 'move'].map(k => [k, {
    sent: r.sent[k],
    missingPct: r.delivery[k].missingPct,
    lostToSomeone: r.delivery[k].messagesLostToSomeone,
    stalePct: r.stale[k].stalePct,
    p50: r.latencyMs[k].p50, p95: r.latencyMs[k].p95, max: r.latencyMs[k].max,
    outOfOrder: r.disorder[k],
  }])));
  console.log('heartbeat', r.heartbeat, 'sockets closed', r.closes.length);
  console.table(r.perStudent);
  console.log('lambda', JSON.stringify({ ...r.lambda, containers: undefined }));
  console.table(r.lambda.containers);
}
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
process.exit(0);
