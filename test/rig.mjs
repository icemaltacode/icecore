/* Real browsers, scripted, against the live site.
 *
 *   AWS_PROFILE=ice npm run test:rig -- [--label before] [--out results.json]
 *                                       [--only follow,cut,editor,share,draw]
 *
 * Phase 0c of LIVE-RELIABILITY.md. The synthetic classroom speaks the protocol, so it cannot see
 * the CLIENT's faults: a move recorded as sent while the socket was down, a Share editor button
 * that never heard back, a snapshot too big to cross. This drives the real player, in two real
 * Chromiums, signed in as a real educator and a real test student.
 *
 * Needs two debug profiles running and signed in - the educator (an admin) on port 9222, the
 * student on 9223. The command is in LIVE-RELIABILITY.md under "Proving it".
 *
 * EVERYTHING IS MEASURED ON THE WIRE, in both browsers: every frame the educator's tab sends
 * and every frame the student's tab receives, timestamped in this one process. Plus what the
 * student's screen actually shows where that is the question - which slide, which row, what
 * text is in the demonstration.
 *
 * IT WORKS IN A COHORT OF ITS OWN (`zz-rig-*`) holding only the test student, so a real class is
 * never invited to anything. It ends the session through the real route and removes the cohort,
 * the membership, the history row and the bookmark afterwards.
 *
 * It cuts the educator's socket on demand through API Gateway's own management API, which is
 * exactly what the two-hour cap and an oversized frame do - so neither has to be waited for.
 *
 * It moves the educator's own place in the course and leaves drafts in the debug profiles. Both
 * belong to test accounts or to profiles that exist for this.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- arguments
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const LABEL = String(arg('label', 'run'));
const OUT = arg('out', null);
const ONLY = String(arg('only', 'follow,cut,editor,share,draw')).split(',');
const COURSE = 'icex-python-oney';
const EXERCISE = 'Your First NumPy Array';   // topic 1.1.1's first exercise; its slides row is just before it

if (process.env.AWS_PROFILE !== 'ice') {
  console.log('REFUSED  set AWS_PROFILE=ice - the default profile is another account');
  process.exit(2);
}

// ---------------------------------------------------------------- dependencies
/* Playwright lives in a course repo's slides/ - it is there for the PDF export - and the SDK in
 * infra/. Neither belongs in the platform's own dependencies for the sake of one test. */
const ROOT = path.join(import.meta.dirname, '..');
const slides = readdirSync(path.dirname(ROOT))
  .map(d => path.join(path.dirname(ROOT), d, 'slides'))
  .find(d => existsSync(path.join(d, 'node_modules', 'playwright-core')));
if (!slides || !existsSync(path.join(ROOT, 'infra', 'node_modules'))) {
  console.log('SKIP  rig: needs playwright-core in a course repo\'s slides/ and infra/node_modules');
  process.exit(0);
}
const { chromium } = createRequire(path.join(slides, 'package.json'))('playwright-core');
const infra = createRequire(path.join(ROOT, 'infra', 'package.json'));
const sdk = {
  ...infra('@aws-sdk/client-dynamodb'),
  ...infra('@aws-sdk/lib-dynamodb'),
  ...infra('@aws-sdk/client-apigatewaymanagementapi'),
};

const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const REGION = execFileSync('aws', ['configure', 'get', 'region'], { encoding: 'utf8' }).trim();
const outputs = Object.fromEntries(aws('cloudformation', 'describe-stacks', '--stack-name', 'Icecore')
  .Stacks[0].Outputs.map(o => [o.OutputKey, o.OutputValue]));
const TABLE = aws('cloudformation', 'list-stack-resources', '--stack-name', 'Icecore')
  .StackResourceSummaries.find(r => r.ResourceType === 'AWS::DynamoDB::Table'
                                 && r.LogicalResourceId.startsWith('Table'))?.PhysicalResourceId;
const SITE = outputs.SiteUrl.replace(/\/$/, '');
const SOCKET = outputs.LiveSocketUrl;
const ddb = sdk.DynamoDBDocumentClient.from(new sdk.DynamoDBClient({ region: REGION }));
const gateway = new sdk.ApiGatewayManagementApiClient({
  region: REGION, endpoint: SOCKET.replace(/^wss:/, 'https:'),
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Poll until `fn` is truthy. The elapsed ms, or null if it never was within `timeout`. */
async function until(fn, timeout, every = 40) {
  const t0 = Date.now();
  for (;;) {
    if (await fn().catch(() => false)) return Date.now() - t0;
    if (Date.now() - t0 > timeout) return null;
    await sleep(every);
  }
}
const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const spread = xs => ({ n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95),
                        max: xs.length ? Math.round(Math.max(...xs)) : null });

// ---------------------------------------------------------------- not during a lesson
{
  const r = await ddb.send(new sdk.QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': 'COHORTS', ':sk': 'LIVE#' },
  }));
  const real = (r.Items || []).filter(i => !i.sk.startsWith('LIVE#zz-'));
  if (real.length) {
    console.log(`REFUSED  a lesson is running (${real.map(i => i.sk.slice(5)).join(', ')})`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- the two browsers
async function attach(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().startsWith(SITE)) || await context.newPage();
  return { browser, page };
}
const educator = await attach(9222);
const student = await attach(9223);

const whoIs = page => page.evaluate(async () => {
  const { clientId } = await (await fetch('/auth.json')).json();
  const p = `CognitoIdentityServiceProvider.${clientId}`;
  const tok = localStorage.getItem(`${p}.${localStorage.getItem(`${p}.LastAuthUser`)}.idToken`);
  if (!tok) return null;
  const c = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return { sub: c.sub, email: c.email, name: c.name || '', exp: c.exp,
           admin: (c['cognito:groups'] || []).includes('admins') };
});
const [me, them] = [await whoIs(educator.page), await whoIs(student.page)];
if (!me?.admin || !them || them.admin) {
  console.log('REFUSED  port 9222 must be signed in as an admin and 9223 as a student', { me, them });
  process.exit(2);
}
if (Math.min(me.exp, them.exp) * 1000 < Date.now() + 30 * 60_000) {
  console.log('REFUSED  a sign-in expires within half an hour - reload both pages first');
  process.exit(2);
}
console.log(`educator ${me.email}, student ${them.email}`);

/** The HTTP API, called from the educator's page with the educator's own token. */
const api = (method, route, body) => educator.page.evaluate(async ({ method, route, body }) => {
  const { clientId } = await (await fetch('/auth.json')).json();
  const p = `CognitoIdentityServiceProvider.${clientId}`;
  const tok = localStorage.getItem(`${p}.${localStorage.getItem(`${p}.LastAuthUser`)}.idToken`);
  const r = await fetch(`/api/${route}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  });
  return { status: r.status, body: await r.text() };
}, { method, route, body });

// ---------------------------------------------------------------- the wire, in both tabs
/* Every frame, timestamped here. `sent` is the educator's outbound traffic, `got` the student's
 * inbound, and `closes` every socket the educator lost. A socket opened after a reconnection is
 * a new `websocket` event, so the listener is per page rather than per socket. */
const wire = { sent: [], got: [], closes: [], opened: [] };
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
educator.page.on('websocket', ws => {
  if (!ws.url().startsWith(SOCKET)) return;
  wire.opened.push({ who: 'educator', t: Date.now() });
  ws.on('framesent', f => wire.sent.push({ t: Date.now(), size: f.payload.length, m: parse(f.payload) }));
  ws.on('close', () => wire.closes.push({ who: 'educator', t: Date.now() }));
});
student.page.on('websocket', ws => {
  if (!ws.url().startsWith(SOCKET)) return;
  wire.opened.push({ who: 'student', t: Date.now() });
  ws.on('framereceived', f => wire.got.push({ t: Date.now(), size: f.payload.length, m: parse(f.payload) }));
  ws.on('close', () => wire.closes.push({ who: 'student', t: Date.now() }));
});

/* How often the educator was shown "Connection lost". Counted in the page, because the band can
 * come and go between two polls. */
const watchBand = page => page.evaluate(() => {
  window.__away = 0;
  let was = false;
  new MutationObserver(() => {
    const now = !!document.querySelector('.band.away');
    if (now && !was) window.__away += 1;
    was = now;
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
});

// ---------------------------------------------------------------- reading the screens
const slideOf = page => page.evaluate(() => {
  const h = document.querySelector('iframe[data-deck]')?.contentWindow?.location.hash || '';
  const m = /^#\/(\d+)/.exec(h);
  return m ? Number(m[1]) : null;
});
const rowOf = page => page.evaluate(() => document.querySelector('footer .muted')?.textContent?.trim() || null);
const rangeOf = page => page.evaluate(() => {
  const m = /(\d+)\D+(\d+)\s+of/.exec(document.querySelector('.slidestep .count')?.textContent || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
});
/* An editor's text as the reader sees it, WITHOUT the other person's caret. That caret is a
 * widget inside the content carrying their name, so plain innerText on the student's side reads
 * "...Keith Vassallo..." and never equals the educator's. Line by line, with the widget cut out. */
const textOf = sel => {
  const root = document.querySelector(sel);
  if (!root) return null;
  return [...root.querySelectorAll('.cm-line')].map(line => {
    const copy = line.cloneNode(true);
    copy.querySelectorAll('.cm-peer').forEach(n => n.remove());
    return copy.textContent;
  }).join('\n');
};
const deckOf = page => page.frames().find(f => /\/slides\//.test(f.url()));
const buttonText = page => page.evaluate(() =>
  [...document.querySelectorAll('button.sync')].find(b => /editor/i.test(b.textContent))?.textContent.trim() || '');

/* CLICKS ARE DISPATCHED, NOT AIMED. In a narrow window the room panel floats over the footer,
 * and an aimed click lands on the chat box instead - which is a fact about hit-testing on one
 * screen size, not about the live channel this exists to measure. */
const press = loc => loc.first().dispatchEvent('click');
async function contents(page, label) {
  await press(page.locator('button[data-show="contents"]'));
  await page.locator('input.filter').fill(label);
  await press(page.locator('button.entry', { hasText: label }));
  await sleep(800);
}
const next = page => press(page.locator('button[data-show="next"]'));
const previous = page => press(page.locator('footer button', { hasText: 'Previous' }));
/* Down and up are Slidev's "next slide" and "previous slide", skipping click steps - a click
 * step does not travel, so only whole slides are something a student can be seen to follow.
 *
 * DISPATCHED INTO THE DECK'S OWN WINDOW, down and then up. Pressed through the page, the keys
 * never reached the frame at all and not one slide moved - which scored every step as the
 * student "following", because both screens were already on the same slide. Slidev's shortcuts
 * track the key being held, so a keydown without its keyup would fire once and never again. */
const slideStep = async (page, key) => {
  await deckOf(page).evaluate(k => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k, bubbles: true }));
  }, key);
};

/** The educator's own connection ids, as the Lambda's rows name them. */
async function educatorConnections(cohort) {
  const r = await ddb.send(new sdk.QueryCommand({
    TableName: TABLE, IndexName: 'byCourse',
    KeyConditionExpression: 'sk = :sk',
    ExpressionAttributeValues: { ':sk': `LIVECONN#${cohort}` },
  }));
  return (r.Items || []).filter(i => i.sub === me.sub).map(i => i.pk.slice('CONN#'.length));
}
/** What the two-hour cap and a 1009 do: API Gateway closes the socket from its side. */
async function cut(cohort) {
  const ids = await educatorConnections(cohort);
  let done = 0;
  for (const id of ids) {
    try { await gateway.send(new sdk.DeleteConnectionCommand({ ConnectionId: id })); done += 1; }
    catch (e) { console.log('  cut failed', id, e.name, e.message); }
  }
  return { found: ids.length, cut: done };
}

// ---------------------------------------------------------------- the session
const COHORT = `zz-rig-${Date.now().toString(36)}`;
const put = Item => ddb.send(new sdk.PutCommand({ TableName: TABLE, Item }));
const del = Key => ddb.send(new sdk.DeleteCommand({ TableName: TABLE, Key })).catch(() => {});

async function setup() {
  await put({ pk: 'COHORTS', sk: `COHORT#${COHORT}`, cohort: COHORT, title: 'Rig (synthetic)',
              created: new Date().toISOString(), archived: false, courses: [COURSE] });
  await put({ pk: `USER#${them.sub}`, sk: `COHORT#${COHORT}`, cohort: COHORT,
              email: them.email, name: them.name });
  const r = await api('POST', 'live/session', { cohort: COHORT, course: COURSE });
  if (r.status !== 200) throw new Error(`could not start a session: ${r.status} ${r.body}`);
  const url = `${SITE}/index.html?course=${COURSE}#/live/${COHORT}`;
  await educator.page.goto(url);
  await student.page.goto(url);
  const ok = await until(async () => (await educator.page.locator('.band').count())
                                  && (await student.page.locator('.band', { hasText: 'Following' }).count()), 30_000);
  if (ok == null) throw new Error('the two pages never both reached the live session');
  await watchBand(educator.page);
  // The slides row of topic 1.1.1: its first exercise, then one row back.
  await contents(educator.page, EXERCISE);
  await previous(educator.page);
  await until(async () => (await slideOf(educator.page)) != null, 15_000);
  await until(async () => (await rowOf(student.page)) === (await rowOf(educator.page)), 15_000);
  await sleep(1500);
}

async function teardown() {
  await api('DELETE', `live/session?cohort=${encodeURIComponent(COHORT)}`).catch(() => {});
  await sleep(1000);
  const r = await ddb.send(new sdk.QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': 'COHORTS', ':sk': `LIVE` },
  })).catch(() => ({ Items: [] }));
  for (const i of r.Items || []) {
    if (i.sk.includes(COHORT)) await del({ pk: i.pk, sk: i.sk });
  }
  await del({ pk: 'COHORTS', sk: `COHORT#${COHORT}` });
  await del({ pk: `USER#${them.sub}`, sk: `COHORT#${COHORT}` });
  // Back to an ordinary page, so neither profile is left sitting in a session that has gone.
  await educator.page.goto(`${SITE}/index.html`).catch(() => {});
  await student.page.goto(`${SITE}/index.html`).catch(() => {});
}

// ---------------------------------------------------------------- scenarios
const results = { label: LABEL, startedAt: new Date().toISOString(), scenarios: {} };

/** How long after `t0` - the educator's press - the student's screen was in the same place,
 * or null if it never got there within `timeout`. */
async function followed(kind, timeout = 5000, t0 = Date.now(), from = undefined, theirs = undefined) {
  const read = kind === 'slide' ? slideOf : rowOf;
  const want = await read(educator.page);
  /* AND ONE THAT LANDS WHERE THE STUDENT ALREADY WAS PROVES NOTHING EITHER. After a lost move,
   * the next move back lands the educator on the student's slide, and that scored as followed.
   * `theirs` is where the student was before the press. */
  if (theirs !== undefined && want === theirs) return 'already-there';
  /* A PRESS THAT DID NOT MOVE THE EDUCATOR IS NOT A MOVE THE STUDENT FOLLOWED. Both screens
   * already agree, so without this it scores as an instant success - which is how a key that
   * never reached the deck, or a slide clamped at the end of its range, would pass for the
   * channel working. `from` is where the educator was before the press. */
  if (from !== undefined && want === from) return 'no-move';
  const ms = await until(async () => (await read(student.page)) === want, timeout);
  return ms == null ? null : Date.now() - t0;
}

async function follow() {
  const steps = [];
  const [lo, hi] = (await rangeOf(educator.page)) || [null, null];
  const span = lo && hi ? Math.min(hi - lo, 7) : 5;
  for (const key of [...Array(span).fill('ArrowDown'), ...Array(span).fill('ArrowUp')]) {
    const [from, theirs] = [await slideOf(educator.page), await slideOf(student.page)];
    const t0 = Date.now();
    await slideStep(educator.page, key);
    await sleep(300);
    steps.push({ kind: 'slide', t0, from, theirs, ms: await followed('slide', 5000, t0, from, theirs),
                 now: await slideOf(educator.page), student: await slideOf(student.page) });
    await sleep(1500);
  }
  for (const go of [next, next, previous, previous, next, next, previous, previous]) {
    const [from, theirs] = [await rowOf(educator.page), await rowOf(student.page)];
    const t0 = Date.now();
    await go(educator.page);
    await sleep(300);
    steps.push({ kind: 'row', ms: await followed('row', 5000, t0, from, theirs) });
    await sleep(1500);
  }
  /* THE WIRE UNDER EACH STEP, when asked: what the educator's tab reported and what the
   * student's tab was told. The difference between "never sent", "sent and not relayed" and
   * "relayed and not applied" is three different bugs. */
  if (arg('trace') === true) {
    results.trace = {
      steps,
      sent: wire.sent.filter(f => f.m?.type === 'active').map(f => ({ t: f.t, at: f.m.at, slide: f.m.slide })),
      got: wire.got.filter(f => f.m?.type === 'moved').map(f => ({ t: f.t, at: f.m.position?.exercise, slide: f.m.position?.slide })),
    };
  }
  const noMove = steps.filter(s => s.ms === 'no-move' || s.ms === 'already-there').length;
  const real = steps.filter(s => s.ms !== 'no-move' && s.ms !== 'already-there');
  const ms = real.map(s => s.ms).filter(x => x != null);
  return { steps: real.length, pressesThatDidNotMove: noMove,
           missed: real.filter(s => s.ms == null).length,
           missedSlides: real.filter(s => s.kind === 'slide' && s.ms == null).length,
           missedRows: real.filter(s => s.kind === 'row' && s.ms == null).length,
           latencyMs: spread(ms) };
}

async function cutThenMove() {
  const trials = [];
  /* ALWAYS FORWARD, from the start of the range, so no trial's destination is somewhere the
   * student was left by an earlier one. */
  for (let i = 0; i < 8; i++) { await slideStep(educator.page, 'ArrowUp'); await sleep(150); }
  await followed('slide', 10_000);
  await sleep(1500);
  for (let i = 0; i < 6; i++) {
    const key = 'ArrowDown';
    const closes = wire.closes.filter(c => c.who === 'educator').length;
    const how = await cut(COHORT);
    // Wait for the tab to SEE the close - that, not the API call returning, is the moment it
    // starts reconnecting and a press has nowhere to go.
    const seen = await until(async () => wire.closes.filter(c => c.who === 'educator').length > closes, 3000);
    await sleep(150);
    const [from, theirs] = [await slideOf(educator.page), await slideOf(student.page)];
    const away = await educator.page.locator('.band.away').count() > 0;
    const t0 = Date.now();
    await slideStep(educator.page, key);
    await sleep(300);
    const ms = await followed('slide', 15_000, t0, from, theirs);
    trials.push({ ms, ...how, closeSeen: seen != null, reconnectingAtPress: away });
    // Let the educator's socket come back before the next cut.
    await until(async () => !(await educator.page.locator('.band.away').count()), 20_000);
    await sleep(3000);
  }
  const real = trials.filter(t => t.ms !== 'no-move' && t.ms !== 'already-there');
  return { trials: real.length, pressesThatDidNotMove: trials.length - real.length,
           socketActuallyCut: trials.filter(t => t.closeSeen).length,
           reconnectingAtPress: trials.filter(t => t.reconnectingAtPress).length,
           neverFollowed: real.filter(t => t.ms == null).length,
           latencyMs: spread(real.map(t => t.ms).filter(x => x != null)) };
}

async function editor() {
  // Onto the exercise; the student follows.
  await next(educator.page);
  await followed('row', 10_000);
  await sleep(1000);
  if (!/Sharing/.test(await buttonText(educator.page))) {
    await press(educator.page.locator('button.sync', { hasText: 'Share editor' }));
    await until(async () => /Sharing/.test(await buttonText(educator.page)), 10_000);
  }
  const mark = wire.sent.length;
  const markGot = wire.got.length;
  const box = educator.page.locator('.one:not(.theirs) .cm-content').first();
  await box.focus();
  await educator.page.keyboard.press('Control+End');
  const lines = [
    'import numpy as np  # the rig is typing this',
    'heights = [1.73, 1.68, 1.71, 1.89, 1.79]',
    'np_heights = np.array(heights)',
    'print(np_heights * 2 + 1)',
  ];
  const converge = [];
  const typed = [];
  for (const line of lines) {
    await educator.page.keyboard.press('Enter');
    const began = Date.now();
    await educator.page.keyboard.type(line, { delay: 110 });   // about nine keys a second
    const stopped = Date.now();
    typed.push({ began, stopped });
    // When typing stops: how long until the student's demonstration shows exactly what the
    // educator's editor shows. Null is "never caught up" within ten seconds.
    const ms = await until(async () => {
      const [a, b] = await Promise.all([
        educator.page.evaluate(textOf, '.one:not(.theirs) .cm-content'),
        student.page.evaluate(textOf, '.one.theirs .cm-content'),
      ]);
      return a != null && a === b;
    }, 10_000);
    converge.push({ ms, after: Date.now() - stopped });
    await sleep(2500);
  }
  /* Push by push: when the student's tab received the text the educator's tab sent. */
  const pushes = wire.sent.slice(mark).filter(f => f.m?.type === 'push');
  const synced = wire.got.slice(markGot).filter(f => f.m?.type === 'synced');
  const firstGot = new Map();
  for (const f of synced) if (!firstGot.has(f.m.code)) firstGot.set(f.m.code, f.t);
  const lat = [];
  let lost = 0;
  for (const p of pushes) {
    const t = firstGot.get(p.m.code);
    if (t == null) lost += 1; else lat.push(t - p.t);
  }
  // Out of order: a push arriving after one the educator sent later.
  const order = new Map(pushes.map((p, i) => [p.m.code, i]));
  let disorder = 0, high = -1;
  for (const f of synced) {
    const i = order.get(f.m.code);
    if (i == null) continue;
    if (i < high) disorder += 1;
    high = Math.max(high, i);
  }
  /* WHAT THE STUDENT SEES WHILE THE EDUCATOR TYPES: for each line, how long after the first
   * keystroke any of it reached them, and how many updates they saw while it was being typed.
   * A student watching a line appear whole, seconds late, is the "it lags" report. */
  const firstShown = typed.map(({ began }) => {
    const f = synced.find(g => g.t >= began);
    return f ? f.t - began : null;
  });
  const updatesWhileTyping = typed.map(({ began, stopped }) =>
    synced.filter(g => g.t >= began && g.t <= stopped).length);
  return { keystrokes: lines.reduce((n, l) => n + l.length + 1, 0), pushes: pushes.length,
           firstShownMs: spread(firstShown.filter(x => x != null)),
           updatesWhileTyping, lostPushes: lost, latencyMs: spread(lat), outOfOrder: disorder,
           pauses: converge.length, neverCaughtUp: converge.filter(c => c.ms == null).length,
           catchUpMs: spread(converge.map(c => c.ms).filter(x => x != null)) };
}

async function share() {
  const trials = [];
  for (let i = 0; i < 10; i++) {
    const was = /Sharing/.test(await buttonText(educator.page));
    const markGot = wire.got.length;
    await press(educator.page.locator('button.sync', { hasText: /editor/ }));
    const own = await until(async () => /Sharing/.test(await buttonText(educator.page)) !== was, 5000);
    const theirs = await until(async () => wire.got.slice(markGot)
      .some(f => f.m?.type === 'syncing' && f.m.on === !was), 5000);
    trials.push({ own, theirs });
    await sleep(1500);
  }
  return { presses: trials.length,
           didNothing: trials.filter(t => t.own == null).length,
           studentNeverTold: trials.filter(t => t.theirs == null).length,
           buttonMs: spread(trials.map(t => t.own).filter(x => x != null)) };
}

async function draw() {
  // Back to the slides row, and the pen out.
  await previous(educator.page);
  await followed('row', 10_000);
  await until(async () => (await slideOf(educator.page)) != null, 15_000);
  const [lo, hi] = (await rangeOf(educator.page)) || [5, 9];
  const deck = deckOf(educator.page);
  const pen = deck.locator('button[title="Show drawing toolbar"]');
  if (await pen.count()) await pen.first().click();
  await sleep(500);
  const stylus = deck.locator('button[title="Draw with stylus"]');
  if (await stylus.count()) await stylus.first().click();
  const markSent = wire.sent.length;
  const markGot = wire.got.length;
  const closesBefore = wire.closes.filter(c => c.who === 'educator').length;
  const follows = [];
  const frame = await educator.page.locator('iframe[data-deck]').boundingBox();
  /* The strokes stay left of anything floating over the deck - the room panel does, in a
   * narrow window - or the pen lands on the panel and the slide gets half a word. */
  const panel = await educator.page.locator('aside.roompanel').boundingBox().catch(() => null);
  const right = panel && panel.x > frame.x ? Math.min(frame.x + frame.width, panel.x) : frame.x + frame.width;
  frame.width = Math.max(200, right - frame.x - 20);
  const slidesToDraw = Math.max(1, Math.min(hi - lo, 5));
  for (let s = 0; s < slidesToDraw; s++) {
    // Three "words" of handwriting: long, dense strokes, which is what grows a snapshot fastest.
    for (let w = 0; w < 3; w++) {
      const x0 = frame.x + frame.width * 0.15, y0 = frame.y + frame.height * (0.3 + 0.15 * w);
      await educator.page.mouse.move(x0, y0);
      await educator.page.mouse.down();
      for (let i = 0; i < 160; i++) {
        await educator.page.mouse.move(x0 + i * frame.width * 0.004,
                                       y0 + Math.sin(i / 3) * frame.height * 0.04, { steps: 1 });
      }
      await educator.page.mouse.up();
      await sleep(900);   // the pen lifts; the settle snapshot goes 600ms later
    }
    // Then move on, straight away - which is what an educator does.
    /* The pen is put down to move on - with Slidev's drawing toolbar open the arrow keys do not
     * change slides - and picked up again after, as an educator does. */
    const hide = deck.locator('button[title="Hide drawing toolbar"]');
    if (await hide.count()) await hide.first().dispatchEvent('click');
    await sleep(200);
    const [from, theirs] = [await slideOf(educator.page), await slideOf(student.page)];
    const t0 = Date.now();
    await slideStep(educator.page, 'ArrowDown');
    await sleep(300);
    follows.push(await followed('slide', 5000, t0, from, theirs));
    const show = deck.locator('button[title="Show drawing toolbar"]');
    if (await show.count()) await show.first().dispatchEvent('click');
    await sleep(1500);
  }
  const deckFrames = wire.sent.slice(markSent).filter(f => f.m?.type === 'deck' || f.m?.type === 'part');
  const arrived = wire.got.slice(markGot).filter(f => f.m?.type === 'decked' || f.m?.type === 'part');
  /* THE MESSAGES TOO BIG FOR THE LAMBDA'S 32KB DECK LIMIT - the snapshots, mostly - and how
   * many of them reached the student whole. Before parts they went as one frame and the Lambda
   * dropped them; in parts, a message counts only once every one of its parts has arrived. */
  const bigSent = new Map();       // key -> parts expected
  for (const f of deckFrames) {
    if (f.m.type === 'deck' && f.size > 32 * 1024) bigSent.set(`seq:${f.m.seq}`, 1);
    if (f.m.type === 'part') bigSent.set(`part:${f.m.id}`, f.m.total);
  }
  const bigGot = new Map();
  for (const f of arrived) {
    if (f.m.type === 'decked' && bigSent.has(`seq:${f.m.seq}`)) bigGot.set(`seq:${f.m.seq}`, 1);
    if (f.m.type === 'part') {
      const k = `part:${f.m.id}`;
      bigGot.set(k, (bigGot.get(k) || 0) + 1);
    }
  }
  const bigWhole = [...bigSent].filter(([k, n]) => (bigGot.get(k) || 0) >= n).length;
  const away = await educator.page.evaluate(() => window.__away || 0);
  const pen2 = deck.locator('button[title="Hide drawing toolbar"]');
  if (await pen2.count()) await pen2.first().click().catch(() => {});
  return {
    slides: slidesToDraw, strokes: slidesToDraw * 3,
    deckFramesSent: deckFrames.length, largestFrameKB: +(Math.max(0, ...deckFrames.map(f => f.size)) / 1024).toFixed(1),
    framesOver32KB: deckFrames.filter(f => f.size > 32 * 1024).length,
    bigMessagesSent: bigSent.size,
    bigMessagesReachedStudentWhole: bigWhole,
    deckFramesArrived: arrived.length,
    educatorSocketCut: wire.closes.filter(c => c.who === 'educator').length - closesBefore,
    connectionLostShown: away,
    movesAfterDrawing: follows.filter(x => x !== 'no-move' && x !== 'already-there').length,
    pressesThatDidNotMove: follows.filter(x => x === 'no-move' || x === 'already-there').length,
    movesNotFollowed: follows.filter(x => x == null).length,
  };
}

// ---------------------------------------------------------------- run
const SCENARIOS = { follow, cut: cutThenMove, editor, share, draw };
try {
  await setup();
  for (const name of ['follow', 'cut', 'editor', 'share', 'draw']) {
    if (!ONLY.includes(name)) continue;
    console.log(`-- ${name}`);
    try {
      results.scenarios[name] = await SCENARIOS[name]();
    } catch (e) {
      results.scenarios[name] = { error: e.message };
    }
    console.log(JSON.stringify(results.scenarios[name]));
  }
  results.educatorSocketsLost = wire.closes.filter(c => c.who === 'educator').length;
  results.educatorSocketsOpened = wire.opened.filter(o => o.who === 'educator').length;
} catch (e) {
  results.error = e.message;
  console.log('FAIL ', e.message);
} finally {
  await teardown();
  results.endedAt = new Date().toISOString();
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  process.exit(0);
}
